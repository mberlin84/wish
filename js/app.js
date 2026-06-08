// App principal: une cámara, OCR, almacenamiento e interfaz.
import * as store from './store.js';
import * as camera from './camera.js';
import * as ocr from './ocr.js';

let state = store.load();

const $ = (id) => document.getElementById(id);

// ---------- Navegación por pestañas ----------
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach((p) => {
        p.hidden = p.id !== `tab-${tab}`;
      });
      if (tab === 'lists') renderLists();
      if (tab === 'album') renderAlbumEditor();
      if (tab !== 'scan' && camera.isActive()) {
        camera.stop($('video'));
        showCameraControls(false);
      }
    });
  });
}

// ---------- Lógica central: agregar una lámina ----------
function addSticker(rawCode) {
  const code = store.normalizeCode(rawCode);
  if (!code) return { status: 'empty' };

  const inAlbum = store.isInAlbum(state.album, code);
  const prev = state.owned[code] || 0;
  state.owned[code] = prev + 1;
  store.save(state);
  renderStats();

  let status;
  if (prev === 0) status = inAlbum ? 'new' : 'new-foreign';
  else status = 'duplicate';

  return { status, code, count: state.owned[code], inAlbum };
}

function feedbackFor(result) {
  switch (result.status) {
    case 'empty':
      return { cls: 'warn', msg: 'No se detectó ningún número. Inténtalo de nuevo o escríbelo.' };
    case 'new':
      return { cls: 'ok', msg: `✅ Lámina ${result.code} agregada a tu colección.` };
    case 'new-foreign':
      return { cls: 'warn', msg: `⚠️ ${result.code} agregada, pero no pertenece al álbum configurado.` };
    case 'duplicate':
      return { cls: 'dup', msg: `♻️ ${result.code} REPETIDA (tienes ${result.count}). Va a la lista de repetidas.` };
    default:
      return { cls: '', msg: '' };
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

  $('addBtn').addEventListener('click', () => {
    const result = addSticker($('codeInput').value);
    showConfirmFeedback(result);
    $('codeInput').value = '';
  });
  $('codeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('addBtn').click();
  });

  $('manualAddBtn').addEventListener('click', () => {
    const result = addSticker($('manualInput').value);
    const fb = feedbackFor(result);
    setOcrStatus(fb.msg);
    $('manualInput').value = '';
    $('manualInput').focus();
  });
  $('manualInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('manualAddBtn').click();
  });
}

async function onScan() {
  try {
    camera.captureScanRegion($('video'), $('captureCanvas'));
    setOcrStatus('Leyendo número…');
    $('scanBtn').disabled = true;
    const res = await ocr.recognize($('captureCanvas'), (m) => {
      if (m.status === 'recognizing text') {
        setOcrStatus(`Leyendo número… ${Math.round((m.progress || 0) * 100)}%`);
      } else if (m.status && m.status.startsWith('loading')) {
        setOcrStatus('Preparando OCR (primera vez)…');
      }
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
  const { have, missing, repeated, extras, foreign } = store.computeLists(state);

  $('repeatedCount').textContent = repeated.length;
  $('missingCount').textContent = missing.length;
  $('haveCount').textContent = have.length;

  // Repetidas
  const repEl = $('repeatedList');
  repEl.innerHTML = '';
  if (!repeated.length) {
    repEl.innerHTML = '<span class="chip-empty">Sin repetidas todavía.</span>';
  } else {
    repeated.forEach((r) => {
      const chip = makeChip(`${r.code}`, 'repeated', () => decrement(r.code));
      const x = document.createElement('span');
      x.className = 'x';
      x.textContent = `×${r.extra + 1}`;
      chip.appendChild(x);
      chip.title = 'Toca para quitar una unidad';
      repEl.appendChild(chip);
    });
  }
  if (foreign.length) {
    foreign.forEach((f) => {
      const chip = makeChip(`${f.code} (fuera del set)`, 'repeated', () => removeCode(f.code));
      repEl.appendChild(chip);
    });
  }

  // Faltantes (con filtro)
  const missEl = $('missingList');
  missEl.innerHTML = '';
  const filtered = missingFilterValue
    ? missing.filter((c) => c.includes(missingFilterValue.toUpperCase()))
    : missing;
  if (!filtered.length) {
    missEl.innerHTML = '<span class="chip-empty">' +
      (missing.length ? 'Nada coincide con el filtro.' : '🎉 ¡No te falta ninguna!') + '</span>';
  } else {
    filtered.forEach((c) => {
      missEl.appendChild(makeChip(c, '', () => {
        addSticker(c);
        renderLists();
      }));
    });
  }

  // Tengo
  const haveEl = $('haveList');
  haveEl.innerHTML = '';
  if (!have.length) {
    haveEl.innerHTML = '<span class="chip-empty">Aún no registras ninguna.</span>';
  } else {
    have.forEach((c) => {
      const count = state.owned[c];
      const chip = makeChip(count > 1 ? `${c} ×${count}` : c, 'have', () => decrement(c));
      haveEl.appendChild(chip);
    });
  }
}

function makeChip(label, extraClass, onClick) {
  const chip = document.createElement('span');
  chip.className = 'chip' + (extraClass ? ' ' + extraClass : '');
  chip.textContent = label;
  if (onClick) chip.addEventListener('click', onClick);
  return chip;
}

function decrement(code) {
  const c = store.normalizeCode(code);
  if (!state.owned[c]) return;
  state.owned[c] -= 1;
  if (state.owned[c] <= 0) delete state.owned[c];
  store.save(state);
  renderStats();
  renderLists();
}

function removeCode(code) {
  delete state.owned[store.normalizeCode(code)];
  store.save(state);
  renderStats();
  renderLists();
}

function setupLists() {
  $('missingFilter').addEventListener('input', (e) => {
    missingFilterValue = e.target.value.trim();
    renderLists();
  });
  $('shareBtn').addEventListener('click', shareResult);
  $('copyBtn').addEventListener('click', copyResult);
}

function buildResultText() {
  const { missing, repeated, have, total } = store.computeLists(state);
  const lines = [];
  lines.push(`📒 ${state.album.name}`);
  lines.push(`Tengo ${have.length}/${total} · Faltan ${missing.length} · Repetidas ${repeated.reduce((a, r) => a + r.extra, 0)}`);
  lines.push('');
  lines.push(`❌ FALTANTES (${missing.length}):`);
  lines.push(missing.length ? missing.join(', ') : '¡Ninguna!');
  lines.push('');
  lines.push(`♻️ REPETIDAS:`);
  lines.push(repeated.length ? repeated.map((r) => `${r.code} (x${r.extra + 1})`).join(', ') : 'Ninguna');
  return lines.join('\n');
}

async function shareResult() {
  const text = buildResultText();
  if (navigator.share) {
    try { await navigator.share({ title: state.album.name, text }); return; } catch (e) { /* cancelado */ }
  }
  copyResult();
}

async function copyResult() {
  const text = buildResultText();
  try {
    await navigator.clipboard.writeText(text);
    flashListAction('Copiado al portapapeles ✅');
  } catch (e) {
    // Fallback: mostrar en prompt
    window.prompt('Copia el resultado:', text);
  }
}

function flashListAction(msg) {
  const btn = $('copyBtn');
  const old = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = old; }, 1500);
}

// ---------- Pestaña Álbum ----------
function renderAlbumEditor() {
  $('albumNameInput').value = state.album.name || '';
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
      <button class="del-section" title="Eliminar sección">✕</button>
    `;
    row.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const f = inp.dataset.f;
        if (f === 'from' || f === 'to') s[f] = parseInt(inp.value, 10) || 0;
        else s[f] = inp.value;
        store.save(state);
        renderStats();
      });
    });
    row.querySelector('.del-section').addEventListener('click', () => {
      state.album.sections.splice(idx, 1);
      store.save(state);
      renderAlbumEditor();
      renderStats();
    });
    wrap.appendChild(row);
  });
}

function setupAlbum() {
  $('albumNameInput').addEventListener('change', (e) => {
    state.album.name = e.target.value;
    store.save(state);
    renderStats();
  });
  $('addSectionBtn').addEventListener('click', () => {
    state.album.sections.push({ id: 's' + Date.now(), name: 'Nueva', prefix: '', from: 1, to: 10 });
    store.save(state);
    renderAlbumEditor();
  });
  $('exportBtn').addEventListener('click', exportData);
  $('importInput').addEventListener('change', importData);
  $('resetBtn').addEventListener('click', () => {
    if (confirm('¿Borrar TODO (colección y configuración)? Esto no se puede deshacer.')) {
      state = { album: store.defaultAlbum(), owned: {} };
      store.save(state);
      renderStats();
      renderAlbumEditor();
    }
  });
}

function exportData() {
  const blob = new Blob([JSON.stringify({ album: state.album, owned: state.owned }, null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mis-laminas-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.album || !Array.isArray(data.album.sections)) throw new Error('Formato inválido');
      state = { album: data.album, owned: data.owned || {} };
      store.save(state);
      renderStats();
      renderAlbumEditor();
      alert('Datos importados ✅');
    } catch (err) {
      alert('No se pudo importar: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ---------- Service worker (PWA) ----------
function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

// ---------- Init ----------
function init() {
  setupTabs();
  setupScan();
  setupLists();
  setupAlbum();
  renderStats();
  setupServiceWorker();
}

init();
