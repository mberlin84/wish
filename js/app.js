// App principal: cámara + OCR + colección (local o en servidor) + trueque.
import * as store from './store.js';
import * as camera from './camera.js';
import * as ocr from './ocr.js';
import { api, isLoggedIn, setToken, getApiBase, setApiBase } from './api.js';

let state = store.load();      // { album, owned } — fuente local (modo invitado / caché)
let currentUser = null;        // datos del usuario con sesión
let pendingLoc = { lat: null, lng: null }; // ubicación capturada por GPS, pendiente de guardar
let currentChat = null;        // { id, username, city } de la conversación abierta
let lastMsgId = 0;             // último id de mensaje renderizado (para refrescos)
let chatPollTimer = null;      // intervalo de sondeo del chat

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
  if (tab !== 'scan' && camera.isActive()) {
    camera.stop($('video'));
    showCameraControls(false);
  }
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

// ---------- Pestaña Escanear ----------
function showCameraControls(active) {
  $('startCamBtn').hidden = active;
  $('scanBtn').hidden = !active;
  $('stopCamBtn').hidden = !active;
}

function setupScan() {
  $('startCamBtn').addEventListener('click', async () => {
    try {
      setOcrStatus('Activando cámara…');
      await camera.start($('video'));
      showCameraControls(true);
      setOcrStatus('');
    } catch (e) {
      setOcrStatus('No se pudo abrir la cámara: ' + e.message);
    }
  });
  $('stopCamBtn').addEventListener('click', () => {
    camera.stop($('video'));
    showCameraControls(false);
  });
  $('scanBtn').addEventListener('click', onScan);

  $('addBtn').addEventListener('click', async () => {
    const result = await addSticker($('codeInput').value);
    showConfirmFeedback(result);
    if (result.status !== 'error') $('codeInput').value = '';
  });
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addBtn').click(); });

  $('manualAddBtn').addEventListener('click', async () => {
    const result = await addSticker($('manualInput').value);
    setOcrStatus(feedbackFor(result).msg);
    if (result.status !== 'error') $('manualInput').value = '';
    $('manualInput').focus();
  });
  $('manualInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('manualAddBtn').click(); });
}

async function onScan() {
  try {
    camera.captureScanRegion($('video'), $('captureCanvas'));
    setOcrStatus('Leyendo número…');
    $('scanBtn').disabled = true;
    const res = await ocr.recognize($('captureCanvas'), (m) => {
      if (m.status === 'recognizing text') setOcrStatus(`Leyendo número… ${Math.round((m.progress || 0) * 100)}%`);
      else if (m.status && m.status.startsWith('loading')) setOcrStatus('Preparando OCR (primera vez)…');
    });
    setOcrStatus(res.candidate
      ? `Detectado: "${res.candidate}" (confianza ${res.confidence}%)`
      : 'No se reconoció un número claro. Corrígelo abajo.');
    showConfirm(res.candidate);
  } catch (e) {
    setOcrStatus('Error al escanear: ' + e.message);
  } finally {
    $('scanBtn').disabled = false;
  }
}

function showConfirm(candidate) {
  $('confirmBox').hidden = false;
  $('codeInput').value = candidate || '';
  $('confirmFeedback').textContent = '';
  $('confirmFeedback').className = 'confirm-feedback';
  $('codeInput').focus();
  $('codeInput').select();
}
function showConfirmFeedback(result) {
  const fb = feedbackFor(result);
  const el = $('confirmFeedback');
  el.textContent = fb.msg;
  el.className = 'confirm-feedback ' + fb.cls;
}
function setOcrStatus(msg) {
  const el = $('ocrStatus');
  el.hidden = !msg;
  el.textContent = msg;
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
let missingFilterValue = '';
function renderLists() {
  const { have, missing, repeated, foreign } = store.computeLists(state);
  $('repeatedCount').textContent = repeated.length;
  $('missingCount').textContent = missing.length;
  $('haveCount').textContent = have.length;

  const repEl = $('repeatedList');
  repEl.innerHTML = '';
  if (!repeated.length) repEl.innerHTML = '<span class="chip-empty">Sin repetidas todavía.</span>';
  else repeated.forEach((r) => {
    const chip = makeChip(`${r.code}`, 'repeated', () => decrement(r.code));
    const x = document.createElement('span');
    x.className = 'x'; x.textContent = `×${r.extra + 1}`;
    chip.appendChild(x);
    chip.title = 'Toca para quitar una unidad';
    repEl.appendChild(chip);
  });
  foreign.forEach((f) => repEl.appendChild(makeChip(`${f.code} (fuera del set)`, 'repeated', () => decrement(f.code))));

  const missEl = $('missingList');
  missEl.innerHTML = '';
  const filtered = missingFilterValue ? missing.filter((c) => c.includes(missingFilterValue.toUpperCase())) : missing;
  if (!filtered.length) {
    missEl.innerHTML = '<span class="chip-empty">' +
      (missing.length ? 'Nada coincide con el filtro.' : '🎉 ¡No te falta ninguna!') + '</span>';
  } else {
    filtered.forEach((c) => missEl.appendChild(makeChip(c, '', async () => { await addSticker(c); renderLists(); })));
  }

  const haveEl = $('haveList');
  haveEl.innerHTML = '';
  if (!have.length) haveEl.innerHTML = '<span class="chip-empty">Aún no registras ninguna.</span>';
  else have.forEach((c) => {
    const count = state.owned[c];
    haveEl.appendChild(makeChip(count > 1 ? `${c} ×${count}` : c, 'have', () => decrement(c)));
  });
}

function makeChip(label, extraClass, onClick) {
  const chip = document.createElement('span');
  chip.className = 'chip' + (extraClass ? ' ' + extraClass : '');
  chip.textContent = label;
  if (onClick) chip.addEventListener('click', onClick);
  return chip;
}
async function decrement(code) {
  await data.remove(code);
  renderStats();
  renderLists();
}

function setupLists() {
  $('missingFilter').addEventListener('input', (e) => { missingFilterValue = e.target.value.trim(); renderLists(); });
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
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    const mode = b.dataset.auth;
    $('loginForm').hidden = mode !== 'login';
    $('registerForm').hidden = mode !== 'register';
    setAuthFeedback('');
  }));

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api.login({ email: $('loginEmail').value, password: $('loginPassword').value });
      await onAuthSuccess(r);
    } catch (err) { setAuthFeedback(err.message, 'warn'); }
  });

  $('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api.register({
        username: $('regUsername').value, email: $('regEmail').value, password: $('regPassword').value,
      });
      await onAuthSuccess(r);
    } catch (err) { setAuthFeedback(err.message, 'warn'); }
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

async function onAuthSuccess(r) {
  setToken(r.token);
  currentUser = r.user;
  setAuthFeedback('');
  await loadFromServer();
  renderAuthState();
  renderStats();
  startChatPolling();
  updateUnreadBadge();
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
  setupServiceWorker();
}

init();
