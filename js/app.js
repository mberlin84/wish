// App principal: cámara + OCR + colección (local o en servidor) + trueque.
import * as store from './store.js';
import * as camera from './camera.js';
import * as ocr from './ocr.js';
import * as stickers from './stickers.js';
import { api, isLoggedIn, setToken, getApiBase, setApiBase } from './api.js';

let state = store.load();      // { album, owned } — fuente local (modo invitado / caché)
let currentUser = null;        // datos del usuario con sesión
let pendingLoc = { lat: null, lng: null }; // ubicación capturada por GPS, pendiente de guardar
let currentChat = null;        // { id, username, city } de la conversación abierta
let lastMsgId = 0;             // último id de mensaje renderizado (para refrescos)
let chatPollTimer = null;      // intervalo de sondeo del chat
let pendingScanThumb = null;   // foto en color recién capturada, pendiente de asociar a un código

const $ = (id) => document.getElementById(id);
const loggedIn = () => isLoggedIn();

// ---------- Capa de datos (decide local vs servidor) ----------
const data = {
  async add(code) {
    const c = store.normalizeCode(code);
    if (loggedIn()) {
      const r = await api.add(c);
      state.owned[c] = r.count;
    } else {
      state.owned[c] = (state.owned[c] || 0) + 1;
      store.save(state);
    }
    return state.owned[c];
  },
  async remove(code) {
    const c = store.normalizeCode(code);
    if (loggedIn()) {
      const r = await api.remove(c);
      if (r.count > 0) state.owned[c] = r.count;
      else delete state.owned[c];
    } else {
      if (!state.owned[c]) return 0;
      state.owned[c] -= 1;
      if (state.owned[c] <= 0) delete state.owned[c];
      store.save(state);
    }
    return state.owned[c] || 0;
  },
};

// ---------- Navegación por pestañas ----------
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${tab}`; });
  if (tab === 'lists') renderLists();
  if (tab === 'account') renderAlbumEditor();
  if (tab === 'chat') renderChatView();
  // La pestaña Escanear ocupa la pantalla completa (sin scroll). Al salir,
  // apaga la cámara y el bucle de lectura.
  document.body.classList.toggle('scan-active', tab === 'scan');
  if (tab !== 'scan' && camera.isActive()) stopScanning();
}
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// ---------- Lógica: agregar lámina ----------
async function addSticker(rawCode) {
  const code = store.normalizeCode(rawCode);
  if (!code) return { status: 'empty' };
  const inAlbum = store.isInAlbum(state.album, code);
  const prev = state.owned[code] || 0;
  let count;
  try {
    count = await data.add(code);
  } catch (e) {
    return { status: 'error', message: e.message };
  }
  renderStats();
  let status;
  if (prev === 0) status = inAlbum ? 'new' : 'new-foreign';
  else status = 'duplicate';
  return { status, code, count, inAlbum };
}

function feedbackFor(result) {
  switch (result.status) {
    case 'empty': return { cls: 'warn', msg: 'No se detectó ningún número. Inténtalo de nuevo o escríbelo.' };
    case 'error': return { cls: 'warn', msg: '⚠️ ' + (result.message || 'Error al guardar.') };
    case 'new': return { cls: 'ok', msg: `✅ Lámina ${result.code} agregada a tu colección.` };
    case 'new-foreign': return { cls: 'warn', msg: `⚠️ ${result.code} agregada, pero no pertenece al álbum.` };
    case 'duplicate': return { cls: 'dup', msg: `♻️ ${result.code} REPETIDA (tienes ${result.count}). Va a repetidas.` };
    default: return { cls: '', msg: '' };
  }
}

// ---------- Pestaña Escanear (automático, apuntar y leer) ----------
let scanActive = false;     // bucle de lectura en marcha
let ocrBusy = false;        // hay un recognize() en curso
let validCodes = null;      // Set de códigos del álbum (para corregir lecturas)
const votes = new Map();    // código -> puntaje acumulado entre cuadros
const cooldown = new Map(); // código -> timestamp hasta el que se ignora
let emptyStreak = 0;        // cuadros seguidos sin código (para resetear votos)
let toastTimer = null;
let scanMode = 'add';       // 'add' = agrega | 'check' = solo informa | 'album' = repasar huecos
let albumTeam = null;       // prefijo del equipo que se está repasando en modo álbum
const albumHoles = new Set(); // códigos anotados como hueco (no pegados) este repaso

function showCameraControls(active) {
  $('startCamBtn').hidden = active;
  $('stopCamBtn').hidden = !active;
}

function setupScan() {
  $('startCamBtn').addEventListener('click', startScanning);
  $('stopCamBtn').addEventListener('click', stopScanning);

  document.querySelectorAll('#scanMode .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => { scanMode = btn.dataset.mode; applyScanMode(); });
  });

  $('manualAddBtn').addEventListener('click', async () => {
    const result = await addSticker($('manualInput').value);
    showScanToast(result);
    if (result.status !== 'error') $('manualInput').value = '';
    $('manualInput').focus();
  });
  $('manualInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('manualAddBtn').click(); });
}

async function startScanning() {
  try {
    setScanLive('Activando cámara…');
    await camera.start($('video'));
    validCodes = store.albumCodeSet(state.album); // se reconstruye en cada arranque
    votes.clear(); cooldown.clear(); emptyStreak = 0;
    showCameraControls(true);
    scanActive = true;
    applyScanMode();
    scanLoop();
  } catch (e) {
    setScanLive('No se pudo abrir la cámara: ' + e.message);
  }
}

function stopScanning() {
  scanActive = false;
  camera.stop($('video'));
  showCameraControls(false);
  $('cameraHint').textContent = 'Activa la cámara y encuadra el código del reverso (ej. KOR 8)';
  setScanLive('');
}

// Lee un cuadro, lo interpreta y, sin solaparse, se reprograma.
async function scanLoop() {
  if (!scanActive || !camera.isActive()) return;
  if (!ocrBusy && document.visibilityState === 'visible') {
    ocrBusy = true;
    try {
      camera.captureScanRegion($('video'), $('captureCanvas'), scanMode === 'album' ? camera.ALBUM_BOX : camera.SCAN_BOX);
      const res = await ocr.recognize($('captureCanvas'));
      if (scanActive) handleReading(res);
    } catch (_) { /* cuadro malo: seguir */ }
    finally { ocrBusy = false; }
  }
  if (scanActive) setTimeout(scanLoop, 350);
}

// Acumula votos por código entre cuadros; cuando uno se confirma, lo agrega.
function handleReading(res) {
  const m = ocr.bestCode(res.text, validCodes);
  if (!m || !m.code) {
    if (++emptyStreak >= 3) { votes.clear(); setScanLive('Buscando código…'); }
    return;
  }
  emptyStreak = 0;
  const code = m.code;
  const now = performance.now();
  if (now < (cooldown.get(code) || 0)) return; // recién agregado: esperar

  setScanLive(m.valid ? `Detectado ${code}` : `¿"${code}"? acércate`);
  const score = (votes.get(code) || 0) + (m.cost === 0 ? 2 : 1);
  votes.set(code, score);
  if (score >= (m.valid ? 3 : 6)) {
    votes.clear();
    cooldown.set(code, now + 3000); // no re-agregar la misma mientras esté en cuadro
    acceptScan(code);
  }
}

async function acceptScan(code) {
  try { navigator.vibrate && navigator.vibrate(80); } catch (_) {}

  // Modo "Álbum": el código escaneado es un HUECO vacío. Solo lo anotamos como
  // "no pegada" (sin tocar datos, para no borrar una que tengas suelta). Luego
  // "Tengo el resto" marca como pegadas las que NO son hueco.
  if (scanMode === 'album') {
    const { prefix } = stickers.parseCode(code);
    if (!prefix) { setToast(`No reconocí el equipo de ${code}.`, 'warn'); return; }
    if (prefix !== albumTeam) { albumTeam = prefix; albumHoles.clear(); }
    albumHoles.add(code);
    const teamName = stickers.countryFor(prefix)?.name || prefix;
    setToast(`📭 ${code}: hueco anotado (no la tienes pegada). ${teamName}: ${albumHoles.size}.`, 'warn');
    renderAlbumBar();
    return;
  }

  // Modo "¿Me falta?": NO agrega; solo informa el estado de esa lámina.
  if (scanMode === 'check') {
    const count = state.owned[code] || 0;
    const inAlbum = store.isInAlbum(state.album, code);
    if (!inAlbum) setToast(`❓ ${code} no está en el álbum.`, 'warn');
    else if (count === 0) setToast(`✅ TE FALTA: ${code}. ¡Consíguela!`, 'ok');
    else if (count === 1) setToast(`🟡 Ya la tienes: ${code}.`, 'dup');
    else setToast(`🟡 Ya la tienes ×${count}: ${code} (repetida).`, 'dup');
    return;
  }

  // Modo "Agregar": guarda la foto en color ANTES del preprocesado y suma.
  pendingScanThumb = camera.captureColorThumb($('video'));
  const result = await addSticker(code);
  if (result.status !== 'error' && result.code && pendingScanThumb) {
    stickers.setPhoto(result.code, pendingScanThumb);
    pendingScanThumb = null;
  }
  showScanToast(result, true);
}

// Muestra un mensaje en el toast del escáner. Con `undoResult` agrega "Deshacer".
function setToast(msg, cls, undoResult = null) {
  const el = $('scanToast');
  el.hidden = false;
  el.className = 'scan-toast ' + (cls || '');
  el.textContent = msg + ' ';
  if (undoResult) {
    const btn = document.createElement('button');
    btn.className = 'toast-undo';
    btn.textContent = 'Deshacer';
    btn.addEventListener('click', async () => {
      await data.remove(undoResult.code);
      if (undoResult.status === 'new' || undoResult.status === 'new-foreign') stickers.removePhoto(undoResult.code);
      renderStats();
      cooldown.delete(undoResult.code);
      el.className = 'scan-toast';
      el.textContent = `↩️ ${undoResult.code} deshecho.`;
    });
    el.appendChild(btn);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, undoResult ? 4000 : 2500);
}

function showScanToast(result, withUndo = false) {
  const fb = feedbackFor(result);
  const undoable = withUndo && result.code && result.status !== 'error' && result.status !== 'empty';
  setToast(fb.msg, fb.cls, undoable ? result : null);
}

function setScanLive(msg) {
  const el = $('scanLive');
  el.hidden = !msg;
  el.textContent = msg;
}

const SCAN_HINTS = {
  add: 'Centra el código del reverso (ej. KOR 7) en el recuadro',
  check: 'Centra el código del reverso para ver si te falta',
  album: 'Apuntá a un HUECO vacío del álbum (el código grande, ej. AUT 3)',
};

// Aplica el modo de escaneo actual: botón activo, recuadro (chico/álbum),
// pista, estado en vivo y barra de álbum.
function applyScanMode() {
  document.querySelectorAll('#scanMode .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === scanMode));
  const box = document.querySelector('#tab-scan .scan-box');
  if (box) box.classList.toggle('album', scanMode === 'album');
  votes.clear(); cooldown.clear();
  if (camera.isActive()) $('cameraHint').textContent = SCAN_HINTS[scanMode];
  if (scanActive) {
    setScanLive(scanMode === 'album' ? 'Apuntá a un hueco vacío…'
      : scanMode === 'check' ? 'Apunta para ver si te falta…'
      : 'Buscando código…');
  }
  renderAlbumBar();
}

// Barra del modo álbum: equipo en repaso + botón "Tengo el resto".
function renderAlbumBar() {
  const bar = $('albumBar');
  if (scanMode !== 'album' || !albumTeam) { bar.hidden = true; bar.innerHTML = ''; return; }
  const teamName = stickers.countryFor(albumTeam)?.name || albumTeam;
  bar.hidden = false;
  bar.innerHTML = '';
  const info = document.createElement('span');
  info.className = 'album-bar-info';
  info.textContent = `${teamName}: ${albumHoles.size} hueco(s)`;
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary';
  btn.textContent = '✓ Tengo el resto';
  btn.addEventListener('click', () => markRestOfTeam(albumTeam));
  bar.append(info, btn);
}

// Marca como "tengo" (pegadas) todas las láminas del equipo que NO sean hueco.
async function markRestOfTeam(prefix) {
  const section = (state.album.sections || []).find((s) => store.normalizeCode(s.prefix || '') === prefix);
  if (!section) { setToast(`No encuentro el equipo ${prefix} en el álbum.`, 'warn'); return; }
  const from = Math.min(section.from, section.to);
  const to = Math.max(section.from, section.to);
  let added = 0;
  for (let n = from; n <= to; n++) {
    const code = store.normalizeCode((section.prefix || '') + n);
    if (albumHoles.has(code)) continue;             // hueco: dejar como está
    if ((state.owned[code] || 0) === 0) { await data.add(code); added++; }
  }
  renderStats();
  const teamName = stickers.countryFor(prefix)?.name || prefix;
  setToast(`✅ ${teamName}: marqué ${added} como pegadas. Huecos sin marcar: ${albumHoles.size}.`, 'ok');
  albumTeam = null; albumHoles.clear();
  renderAlbumBar();
}

// ---------- Estadísticas ----------
function renderStats() {
  const { have, missing, extras } = store.computeLists(state);
  $('statHave').textContent = have.length;
  $('statMissing').textContent = missing.length;
  $('statRepeated').textContent = extras;
  $('albumName').textContent = state.album.name || 'Álbum';
}

// ---------- Pestaña Listas ----------
let currentList = 'missing';   // 'missing' | 'have' | 'repeated'
let listFilterValue = '';      // texto del buscador
let selectedSection = null;    // sección activa del filtro (null = todas)
const CARD_BATCH = 120;        // cuántos cromos pintar por tanda (el resto, con "Ver más")

// Recalcula contadores, barra de progreso, chips de sección y la grilla activa.
function renderLists() {
  const { have, missing, repeated, foreign, total } = store.computeLists(state);

  $('segMissing').textContent = missing.length;
  $('segHave').textContent = have.length;
  $('segRepeated').textContent = repeated.length + foreign.length;

  const pct = total ? Math.round((have.length / total) * 100) : 0;
  $('cpLabel').textContent = `Colección · ${have.length}/${total}`;
  $('cpPct').textContent = `${pct}%`;
  $('cpFill').style.width = `${pct}%`;

  renderSectionChips();
  renderActiveGrid(false);
}

// Construye los ítems de la categoría activa, aplica filtros y pinta la grilla.
function renderActiveGrid(animate) {
  const { have, missing, repeated, foreign } = store.computeLists(state);
  let items, empty;

  if (currentList === 'missing') {
    items = missing.map((c) => ({ code: c, count: 0, state: 'missing',
      onTap: async () => { await addSticker(c); renderLists(); } }));
    empty = '¡No te falta ninguna! Álbum completo.';
  } else if (currentList === 'have') {
    items = have.map((c) => ({ code: c, count: state.owned[c], state: 'have', onTap: () => openCardModal(c) }));
    empty = 'Aún no registras ninguna. Escanea o agrégalas a mano.';
  } else {
    items = [
      ...repeated.map((r) => ({ code: r.code, count: r.extra + 1, state: 'repeated', onTap: () => openCardModal(r.code) })),
      ...foreign.map((f) => ({ code: f.code, count: f.count, state: 'foreign', onTap: () => openCardModal(f.code) })),
    ];
    empty = 'Sin repetidas todavía. ¡A escanear!';
  }

  // Filtro por sección
  if (selectedSection) {
    items = items.filter((it) => stickers.sectionFor(state.album, it.code) === selectedSection);
  }
  // Filtro por texto
  const q = listFilterValue.toUpperCase();
  const filtered = q ? items.filter((it) => it.code.includes(q)) : items;
  const emptyMsg = (q || selectedSection) && items.length === 0
    ? 'Nada coincide con el filtro.'
    : filtered.length === 0 && items.length > 0
      ? 'Nada coincide con el filtro.'
      : empty;

  const grid = $('listGrid');
  renderCardGrid(grid, filtered, emptyMsg);
  if (animate) { grid.style.animation = 'none'; void grid.offsetWidth; grid.style.animation = ''; }
}

// Chips para filtrar por sección (solo si el álbum tiene más de una).
function renderSectionChips() {
  const wrap = $('sectionChips');
  const secs = state.album.sections || [];
  if (selectedSection && !secs.includes(selectedSection)) selectedSection = null;
  if (secs.length <= 1) { wrap.hidden = true; wrap.innerHTML = ''; selectedSection = null; return; }

  wrap.hidden = false;
  wrap.innerHTML = '';
  const addChip = (label, section) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sec-chip' + (selectedSection === section ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { selectedSection = section; renderActiveGrid(true); renderSectionChips(); });
    wrap.appendChild(b);
  };
  addChip('Todas', null);
  secs.forEach((s) => addChip(s.name || s.prefix || 'Sección', s));
}

// Pinta una grilla de cromos por tandas, con botón "Ver más" para los restantes.
function renderCardGrid(container, items, emptyMsg) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = `<span class="chip-empty">${escapeHtml(emptyMsg)}</span>`;
    return;
  }
  let shown = 0;
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'show-more';
  const renderBatch = () => {
    const slice = items.slice(shown, shown + CARD_BATCH);
    const frag = document.createDocumentFragment();
    slice.forEach((d) => frag.appendChild(stickers.createStickerCard(d.code, {
      count: d.count, state: d.state, album: state.album, onTap: d.onTap,
    })));
    container.insertBefore(frag, moreBtn);
    shown += slice.length;
    if (shown >= items.length) moreBtn.remove();
    else moreBtn.textContent = `Ver más (${items.length - shown})`;
  };
  container.appendChild(moreBtn);
  moreBtn.addEventListener('click', renderBatch);
  renderBatch();
}
async function decrement(code) {
  await data.remove(code);
  renderStats();
  renderLists();
}

// ---------- Detalle de tarjeta (modal) ----------
// Tocar una lámina abre su tarjeta grande; desde ahí se quita, se suma o se
// captura/cambia la foto del FRENTE (jugador) — que está al otro lado del código.
let modalCode = null;

function openCardModal(code) {
  modalCode = code;
  renderCardModal();
  stopModalPhoto(); // asegura que la vista de cámara empiece oculta
  $('cardModal').hidden = false;
}

function renderCardModal() {
  const code = modalCode;
  const count = state.owned[code] || 0;
  const inAlbum = store.isInAlbum(state.album, code);
  const st = !inAlbum ? 'foreign' : count > 1 ? 'repeated' : count >= 1 ? 'have' : 'missing';

  const holder = $('cardModalCard');
  holder.innerHTML = '';
  holder.appendChild(stickers.createStickerCard(code, { count, state: st, album: state.album }));

  const label = count > 1 ? `Tienes ${count} (repetidas)`
    : count === 1 ? 'La tienes'
    : inAlbum ? 'Te falta' : 'No pertenece al álbum';
  $('cardModalInfo').textContent = `${code} · ${label}`;

  const actions = $('cardModalActions');
  actions.innerHTML = '';
  const addBtn = (txt, cls, fn) => {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.textContent = txt;
    b.addEventListener('click', fn);
    actions.appendChild(b);
  };
  addBtn(stickers.getPhoto(code) ? '📷 Cambiar foto' : '📷 Capturar foto', 'btn-secondary', startModalPhoto);
  if (count > 0) addBtn('− Quitar una', 'btn-ghost', () => modalChange(-1));
  addBtn(count > 0 ? '+ Tengo otra' : '+ Agregar', 'btn-primary', () => modalChange(1));
}

async function modalChange(delta) {
  if (delta > 0) await data.add(modalCode); else await data.remove(modalCode);
  renderStats();
  renderCardModal();
}

async function startModalPhoto() {
  try {
    $('cardModalActions').hidden = true;
    $('cardModalCam').hidden = false;
    await camera.start($('cardVideo'), { zoom: false }); // foto del cromo completo, sin zoom
  } catch (e) {
    $('cardModalCam').hidden = true;
    $('cardModalActions').hidden = false;
    $('cardModalInfo').textContent = 'No se pudo abrir la cámara: ' + e.message;
  }
}

function stopModalPhoto() {
  if (camera.isActive()) camera.stop($('cardVideo'));
  $('cardModalCam').hidden = true;
  $('cardModalActions').hidden = false;
}

function snapModalPhoto() {
  const thumb = camera.captureCardPhoto($('cardVideo'));
  if (thumb) stickers.setPhoto(modalCode, thumb);
  stopModalPhoto();
  renderCardModal(); // muestra ya la foto recién tomada
}

function closeCardModal() {
  stopModalPhoto();
  $('cardModal').hidden = true;
  modalCode = null;
  renderLists();
}

function setupCardModal() {
  $('cardModalClose').addEventListener('click', closeCardModal);
  $('cardModalBackdrop').addEventListener('click', closeCardModal);
  $('cardSnapBtn').addEventListener('click', snapModalPhoto);
  $('cardCamCancel').addEventListener('click', stopModalPhoto);
}

function setupLists() {
  document.querySelectorAll('#listSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentList = btn.dataset.list;
      document.querySelectorAll('#listSeg .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderActiveGrid(true);
    });
  });
  $('listFilter').addEventListener('input', (e) => { listFilterValue = e.target.value.trim(); renderActiveGrid(false); });
  $('shareBtn').addEventListener('click', shareResult);
  $('copyBtn').addEventListener('click', copyResult);
}
function buildResultText() {
  const { missing, repeated, have, total } = store.computeLists(state);
  return [
    `📒 ${state.album.name}`,
    `Tengo ${have.length}/${total} · Faltan ${missing.length} · Repetidas ${repeated.reduce((a, r) => a + r.extra, 0)}`,
    '',
    `❌ FALTANTES (${missing.length}):`,
    missing.length ? missing.join(', ') : '¡Ninguna!',
    '',
    `♻️ REPETIDAS:`,
    repeated.length ? repeated.map((r) => `${r.code} (x${r.extra + 1})`).join(', ') : 'Ninguna',
  ].join('\n');
}
async function shareResult() {
  const text = buildResultText();
  if (navigator.share) { try { await navigator.share({ title: state.album.name, text }); return; } catch (e) {} }
  copyResult();
}
async function copyResult() {
  const text = buildResultText();
  try { await navigator.clipboard.writeText(text); flashCopy('Copiado ✅'); }
  catch (e) { window.prompt('Copia el resultado:', text); }
}
function flashCopy(msg) {
  const btn = $('copyBtn'); const old = btn.textContent;
  btn.textContent = msg; setTimeout(() => { btn.textContent = old; }, 1500);
}

// ---------- Cuenta: autenticación ----------
function setupAuth() {
  $('magicForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('magicEmail').value.trim();
    const btn = $('magicBtn');
    btn.disabled = true;
    setAuthFeedback('Enviando enlace…');
    try {
      const r = await api.requestMagicLink(email);
      if (r.dev) {
        setAuthFeedback('Enlace generado (modo desarrollo): revisa los logs del servidor para abrirlo.', 'ok');
      } else {
        setAuthFeedback(`Listo. Te enviamos un enlace a ${email}. Ábrelo en este dispositivo para entrar.`, 'ok');
      }
    } catch (err) {
      setAuthFeedback(err.message, 'warn');
    } finally {
      btn.disabled = false;
    }
  });

  $('logoutBtn').addEventListener('click', () => {
    setToken(null);
    currentUser = null;
    currentChat = null;
    stopChatPolling();
    setBadge(0);
    state = store.load(); // vuelve al modo invitado local
    renderAuthState();
    renderStats();
  });

  $('apiBaseInput').value = getApiBase();
  $('saveApiBaseBtn').addEventListener('click', () => {
    setApiBase($('apiBaseInput').value.trim());
    setAuthFeedback('Servidor guardado ✅', 'ok');
  });
}

// Lee el token (o el error) que el enlace mágico dejó en el fragmento de la URL.
// Devuelve un mensaje de error para mostrar tras renderizar, o null.
function consumeAuthHash() {
  const hash = location.hash || '';
  const clean = () => history.replaceState(null, '', location.pathname + location.search);
  if (hash.startsWith('#session=')) {
    const token = decodeURIComponent(hash.slice('#session='.length));
    clean();
    if (token) setToken(token);
    return null;
  }
  if (hash.startsWith('#login=')) {
    const reason = hash.slice('#login='.length);
    clean();
    return {
      expired: 'El enlace venció (dura 15 min). Pide uno nuevo.',
      used: 'Ese enlace ya se usó. Pide uno nuevo.',
      invalid: 'Enlace inválido. Pide uno nuevo.',
      error: 'No se pudo validar el enlace. Intenta otra vez.',
    }[reason] || 'No se pudo entrar con el enlace.';
  }
  return null;
}

function setAuthFeedback(msg, cls = '') {
  const el = $('authFeedback');
  el.textContent = msg;
  el.className = 'auth-feedback ' + cls;
}

async function loadFromServer() {
  const [albumRes, colRes, meRes] = await Promise.all([api.getAlbum(), api.getCollection(), api.me()]);
  state = { album: albumRes, owned: colRes.owned || {} };
  currentUser = meRes.user;
}

function renderAuthState() {
  const on = loggedIn();
  $('authSection').hidden = on;
  $('profileSection').hidden = !on;
  $('tradeLoggedIn').hidden = !on;
  $('tradeLoggedOut').hidden = on;
  renderChatView();
  if (on && currentUser) {
    $('sessionLine').textContent = `Sesión: ${currentUser.username}`;
    $('profileGreeting').textContent = `Hola, ${currentUser.username} 👋`;
    $('profileEmail').textContent = currentUser.email || '';
    $('cityInput').value = currentUser.city || '';
    pendingLoc = { lat: currentUser.lat ?? null, lng: currentUser.lng ?? null };
  } else {
    $('sessionLine').textContent = 'Modo invitado (datos solo en este dispositivo)';
  }
}

// ---------- Cuenta: ubicación ----------
function setupLocation() {
  $('gpsBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { setLocationFeedback('Este navegador no tiene GPS.', 'warn'); return; }
    setLocationFeedback('Obteniendo ubicación…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pendingLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocationFeedback(`Ubicación lista (±${Math.round(pos.coords.accuracy)} m). Pulsa "Guardar".`, 'ok');
      },
      (err) => setLocationFeedback('No se pudo obtener el GPS: ' + err.message + '. Usa la ciudad manual.', 'warn'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  $('saveLocationBtn').addEventListener('click', async () => {
    try {
      const r = await api.setLocation({ lat: pendingLoc.lat, lng: pendingLoc.lng, city: $('cityInput').value });
      currentUser = r.user;
      setLocationFeedback('Ubicación guardada ✅', 'ok');
    } catch (e) { setLocationFeedback(e.message, 'warn'); }
  });
}
function setLocationFeedback(msg, cls = '') {
  const el = $('locationFeedback');
  el.textContent = msg;
  el.className = 'confirm-feedback ' + cls;
}

// ---------- Cuenta: editor de álbum ----------
function renderAlbumEditor() {
  const wrap = $('sectionsEditor');
  wrap.innerHTML = '';
  state.album.sections.forEach((s, idx) => {
    const row = document.createElement('div');
    row.className = 'section-row';
    row.innerHTML = `
      <div><label>Nombre</label><input data-f="name" value="${escapeAttr(s.name)}" /></div>
      <div><label>Prefijo</label><input data-f="prefix" value="${escapeAttr(s.prefix || '')}" placeholder="(ninguno)" /></div>
      <div><label>Desde</label><input data-f="from" type="number" value="${s.from}" /></div>
      <div><label>Hasta</label><input data-f="to" type="number" value="${s.to}" /></div>
      <button class="del-section" title="Eliminar sección">✕</button>`;
    row.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
      const f = inp.dataset.f;
      if (f === 'from' || f === 'to') s[f] = parseInt(inp.value, 10) || 0;
      else s[f] = inp.value;
      if (!loggedIn()) store.save(state);
      renderStats();
    }));
    row.querySelector('.del-section').addEventListener('click', () => {
      state.album.sections.splice(idx, 1);
      if (!loggedIn()) store.save(state);
      renderAlbumEditor();
      renderStats();
    });
    wrap.appendChild(row);
  });
}

function setupAlbum() {
  $('addSectionBtn').addEventListener('click', () => {
    state.album.sections.push({ name: 'Nueva', prefix: '', from: 1, to: 10 });
    if (!loggedIn()) store.save(state);
    renderAlbumEditor();
  });
  $('saveAlbumBtn').addEventListener('click', async () => {
    if (loggedIn()) {
      try { await api.saveAlbum(state.album.sections); setAlbumFeedback('Álbum guardado en el servidor ✅', 'ok'); }
      catch (e) { setAlbumFeedback(e.message, 'warn'); }
    } else {
      store.save(state);
      setAlbumFeedback('Álbum guardado en este dispositivo ✅', 'ok');
    }
    renderStats();
  });
}
function setAlbumFeedback(msg, cls = '') {
  const el = $('albumFeedback');
  el.textContent = msg;
  el.className = 'confirm-feedback ' + cls;
}

// ---------- Cuenta: datos locales ----------
function setupData() {
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ album: state.album, owned: state.owned }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `mis-laminas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  });
  $('importInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d.album || !Array.isArray(d.album.sections)) throw new Error('Formato inválido');
        state = { album: d.album, owned: d.owned || {} };
        if (!loggedIn()) store.save(state);
        renderStats(); renderAlbumEditor();
        alert('Datos importados ✅' + (loggedIn() ? ' (solo en memoria; con sesión la colección vive en el servidor)' : ''));
      } catch (err) { alert('No se pudo importar: ' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  $('resetBtn').addEventListener('click', () => {
    if (confirm('¿Borrar la colección guardada en ESTE dispositivo (modo invitado)?')) {
      const fresh = { album: store.defaultAlbum(), owned: {} };
      store.save(fresh);
      if (!loggedIn()) { state = fresh; renderStats(); renderAlbumEditor(); }
    }
  });
}

// ---------- Trueque ----------
function setupTrade() {
  $('findTradesBtn').addEventListener('click', findTrades);
}
async function findTrades() {
  const results = $('tradeResults');
  results.innerHTML = '';
  $('tradeHint').textContent = 'Buscando…';
  try {
    const { partners, hasLocation } = await api.trades();
    if (!hasLocation) {
      $('tradeHint').innerHTML = '💡 Agrega tu ubicación en la pestaña <strong>Cuenta</strong> para ordenar por cercanía.';
    } else {
      $('tradeHint').textContent = `${partners.length} persona(s) con coincidencias.`;
    }
    if (!partners.length) {
      results.innerHTML = '<p class="trade-empty">Aún no hay coincidencias. Vuelve cuando más gente registre su colección.</p>';
      return;
    }
    partners.forEach((p) => results.appendChild(renderPartner(p)));
  } catch (e) {
    $('tradeHint').textContent = '';
    results.innerHTML = `<p class="trade-empty">⚠️ ${e.message}</p>`;
  }
}
function renderPartner(p) {
  const el = document.createElement('div');
  el.className = 'partner';
  const mutual = p.theyGive.length > 0 && p.iGive.length > 0;
  const dist = p.distanceKm != null ? `${p.distanceKm} km` : '';
  el.innerHTML = `
    <div class="partner-head">
      <div>
        <span class="partner-name">${escapeHtml(p.username)}</span>${mutual ? '<span class="mutual-badge">trueque mutuo</span>' : ''}
        <div class="partner-meta">${escapeHtml(p.city || 'Sin ciudad')}</div>
      </div>
      <span class="partner-dist">${dist}</span>
    </div>
    ${p.theyGive.length ? `<p class="trade-line get">⬇️ Te puede dar (${p.theyGive.length}):</p><div class="chips">${chipsHtml(p.theyGive)}</div>` : ''}
    ${p.iGive.length ? `<p class="trade-line give">⬆️ Tú le puedes dar (${p.iGive.length}):</p><div class="chips">${chipsHtml(p.iGive)}</div>` : ''}
  `;
  const btn = document.createElement('button');
  btn.className = 'btn btn-chat';
  btn.textContent = '💬 Chatear';
  btn.addEventListener('click', () => openConversation(p.id, p.username, p.city));
  el.appendChild(btn);
  return el;
}
function chipsHtml(codes) {
  return codes.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('');
}

// ---------- Chat ----------
function setupChat() {
  $('chatBackBtn').addEventListener('click', () => {
    currentChat = null;
    renderChatView();
    renderConversations();
  });
  $('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('chatInput');
    const body = input.value.trim();
    if (!body || !currentChat) return;
    input.value = '';
    try {
      const { message } = await api.sendMessage(currentChat.id, body);
      appendMessage(message);
    } catch (err) {
      input.value = body;
      alert('No se pudo enviar: ' + err.message);
    }
  });
}

// Decide qué vista del chat mostrar según sesión y conversación abierta.
function renderChatView() {
  const on = loggedIn();
  $('chatLoggedOut').hidden = on;
  $('chatList').hidden = !on || !!currentChat;
  $('chatConversation').hidden = !on || !currentChat;
  if (on && !currentChat) renderConversations();
  if (on && currentChat) {
    $('chatPeerName').textContent = currentChat.username;
    $('chatPeerMeta').textContent = currentChat.city || '';
  }
}

async function renderConversations() {
  if (!loggedIn()) return;
  let convos = [];
  try { ({ conversations: convos } = await api.conversations()); }
  catch (e) { return; }
  const list = $('conversationsList');
  list.innerHTML = '';
  $('noConversations').hidden = convos.length > 0;
  convos.forEach((c) => {
    const el = document.createElement('div');
    el.className = 'convo';
    const initial = (c.username || '?').charAt(0).toUpperCase();
    const mine = c.last_sender === (currentUser && currentUser.id);
    const preview = (mine ? 'Tú: ' : '') + (c.last_body || '');
    el.innerHTML = `
      <div class="convo-avatar">${escapeHtml(initial)}</div>
      <div class="convo-body">
        <div class="convo-top">
          <span class="convo-name">${escapeHtml(c.username)}</span>
          <span class="convo-time">${formatTime(c.last_at)}</span>
        </div>
        <div class="convo-last">${escapeHtml(preview)}</div>
      </div>
      ${c.unread > 0 ? `<span class="convo-unread">${c.unread}</span>` : ''}`;
    el.addEventListener('click', () => openConversation(c.id, c.username, c.city));
    list.appendChild(el);
  });
}

async function openConversation(userId, username, city) {
  if (!loggedIn()) { switchTab('account'); return; }
  currentChat = { id: userId, username, city };
  lastMsgId = 0;
  switchTab('chat');
  renderChatView();
  $('chatMessages').innerHTML = '<p class="chat-empty-msg">Cargando…</p>';
  try {
    const { user, messages } = await api.messagesWith(userId);
    currentChat = { id: user.id, username: user.username, city: user.city };
    renderChatView();
    renderMessages(messages);
    updateUnreadBadge();
  } catch (e) {
    $('chatMessages').innerHTML = `<p class="chat-empty-msg">⚠️ ${escapeHtml(e.message)}</p>`;
  }
}

function renderMessages(messages) {
  const box = $('chatMessages');
  box.innerHTML = '';
  if (!messages.length) {
    box.innerHTML = '<p class="chat-empty-msg">Aún no hay mensajes. ¡Saluda y propón tu trueque! 👋</p>';
    return;
  }
  messages.forEach((m) => box.appendChild(bubble(m)));
  lastMsgId = messages[messages.length - 1].id;
  box.scrollTop = box.scrollHeight;
}

function appendMessage(m) {
  const box = $('chatMessages');
  const empty = box.querySelector('.chat-empty-msg');
  if (empty) box.innerHTML = '';
  box.appendChild(bubble(m));
  lastMsgId = Math.max(lastMsgId, m.id);
  box.scrollTop = box.scrollHeight;
}

function bubble(m) {
  const mine = currentUser && m.sender_id === currentUser.id;
  const el = document.createElement('div');
  el.className = 'bubble ' + (mine ? 'mine' : 'theirs');
  el.innerHTML = `${escapeHtml(m.body)}<span class="bubble-time">${formatTime(m.created_at)}</span>`;
  return el;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

async function updateUnreadBadge() {
  if (!loggedIn()) { setBadge(0); return; }
  try { const { count } = await api.unreadCount(); setBadge(count); }
  catch (e) { /* ignorar */ }
}
function setBadge(n) {
  const b = $('chatBadge');
  b.textContent = n;
  b.hidden = !n;
}

function startChatPolling() {
  stopChatPolling();
  chatPollTimer = setInterval(chatTick, 5000);
}
function stopChatPolling() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
}
async function chatTick() {
  if (!loggedIn()) { stopChatPolling(); return; }
  updateUnreadBadge();
  const chatVisible = !$('tab-chat').hidden;
  if (!chatVisible) return;
  if (currentChat) {
    try {
      const { messages } = await api.messagesWith(currentChat.id);
      const last = messages.length ? messages[messages.length - 1].id : 0;
      if (last !== lastMsgId) renderMessages(messages);
    } catch (e) { /* ignorar */ }
  } else {
    renderConversations();
  }
}

// ---------- Utilidades ----------
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---------- Service worker ----------
function setupServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
}

// ---------- Init ----------
async function init() {
  setupTabs();
  setupScan();
  setupLists();
  setupAuth();
  setupLocation();
  setupAlbum();
  setupData();
  setupTrade();
  setupChat();
  setupCardModal();

  // Procesa el enlace mágico (guarda el token) ANTES de decidir si hay sesión.
  const authError = consumeAuthHash();

  if (loggedIn()) {
    try {
      await loadFromServer();
      startChatPolling();
      updateUnreadBadge();
    } catch (e) {
      // Si el servidor no responde, seguimos en modo local con lo que haya.
      console.warn('No se pudo cargar del servidor:', e.message);
      setAuthFeedback('No se pudo conectar al servidor; usando datos locales.', 'warn');
    }
  }
  renderAuthState();
  renderStats();
  // Aplica el estado de la pestaña inicial (incl. el modo pantalla-completa del
  // escáner). Si llegó un enlace mágico, abre Cuenta en su lugar.
  if (authError) { switchTab('account'); setAuthFeedback(authError, 'warn'); }
  else { switchTab('scan'); }
  setupServiceWorker();
}

init();
