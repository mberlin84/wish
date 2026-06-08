// Manejo de la cámara y recorte/preprocesado del recuadro de escaneo.

let stream = null;

// Recuadro de escaneo, en fracciones del elemento <video> visible. DEBE
// coincidir con .scan-box en el CSS: lo que ves es exactamente lo que se lee.
export const SCAN_BOX = { left: 0.18, top: 0.40, width: 0.64, height: 0.20 };
// Caja para el código GIGANTE de un hueco del álbum (ej. "AUT 3", a dos líneas):
// más cuadrada y alta. DEBE coincidir con .scan-box.album en el CSS.
export const ALBUM_BOX = { left: 0.24, top: 0.30, width: 0.52, height: 0.40 };

// opts.zoom: aplicar zoom modesto (útil para leer el código pequeño; se apaga
// al capturar la foto del cromo completo).
export async function start(videoEl, { zoom = true } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Este navegador no permite acceder a la cámara.');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  await tuneTrack(zoom);
  return stream;
}

// Mejora el enfoque de cerca: enfoque continuo + un zoom modesto (si el
// dispositivo lo permite) para no tener que acercar tanto la lámina y evitar
// el borroso por la distancia mínima de enfoque del lente.
async function tuneTrack(zoom = true) {
  const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
  if (!track || !track.getCapabilities) return;
  let caps = {};
  try { caps = track.getCapabilities() || {}; } catch { return; }
  const advanced = [];
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
    advanced.push({ focusMode: 'continuous' });
  }
  if (zoom && caps.zoom && typeof caps.zoom.max === 'number') {
    const z = Math.min(2, caps.zoom.max);
    if (z > (caps.zoom.min || 1)) advanced.push({ zoom: z });
  }
  if (advanced.length) { try { await track.applyConstraints({ advanced }); } catch { /* ignorar */ } }
}

// Mapea un recuadro (fracciones del <video> visible) a píxeles del frame crudo,
// teniendo en cuenta object-fit: cover (el video se recorta para llenar la caja).
function coverCrop(videoEl, box) {
  const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
  const cw = videoEl.clientWidth || vw, ch = videoEl.clientHeight || vh;
  const scale = Math.max(cw / vw, ch / vh);
  const offX = (cw - vw * scale) / 2;
  const offY = (ch - vh * scale) / 2;
  let sx = (box.left * cw - offX) / scale;
  let sy = (box.top * ch - offY) / scale;
  let sw = (box.width * cw) / scale;
  let sh = (box.height * ch) / scale;
  // Recortar a los límites del frame.
  sx = Math.max(0, Math.min(sx, vw - 1));
  sy = Math.max(0, Math.min(sy, vh - 1));
  sw = Math.max(1, Math.min(sw, vw - sx));
  sh = Math.max(1, Math.min(sh, vh - sy));
  return { sx, sy, sw, sh };
}

export function stop(videoEl) {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (videoEl) videoEl.srcObject = null;
}

export function isActive() {
  return !!stream;
}

// Captura un recorte EN COLOR del recuadro de escaneo como dataURL (JPEG).
// Se usa para guardar la "foto real" de la lámina (es la foto del usuario).
// Se mantiene pequeño (~150px de alto) para no llenar el cupo de localStorage.
export function captureColorThumb(videoEl) {
  if (!videoEl.videoWidth || !videoEl.videoHeight) return null;

  // Un poco más amplio que el recuadro de OCR para que se vea algo de contexto.
  const { sx, sy, sw, sh } = coverCrop(videoEl, {
    left: Math.max(0, SCAN_BOX.left - 0.06),
    top: Math.max(0, SCAN_BOX.top - 0.06),
    width: Math.min(1, SCAN_BOX.width + 0.12),
    height: Math.min(1, SCAN_BOX.height + 0.12),
  });

  const dh = 180;
  const dw = Math.round(dh * (sw / sh));
  const c = document.createElement('canvas');
  c.width = dw; c.height = dh;
  const ctx = c.getContext('2d');
  ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, dw, dh);
  try { return c.toDataURL('image/jpeg', 0.7); }
  catch { return null; }
}

// Caja guía para fotografiar el FRENTE del cromo (jugador), en fracciones del
// <video> visible. DEBE coincidir con .card-guide en el CSS.
export const CARD_BOX = { left: 0.14, top: 0.08, width: 0.72, height: 0.84 };

// Captura el frente del cromo completo (jugador) en color como dataURL. Más
// grande que el thumb del escaneo porque es la imagen "bonita" de la lámina.
export function captureCardPhoto(videoEl) {
  if (!videoEl.videoWidth || !videoEl.videoHeight) return null;
  const { sx, sy, sw, sh } = coverCrop(videoEl, CARD_BOX);
  const dh = 300;
  const dw = Math.round(dh * (sw / sh));
  const c = document.createElement('canvas');
  c.width = dw; c.height = dh;
  c.getContext('2d').drawImage(videoEl, sx, sy, sw, sh, 0, 0, dw, dh);
  try { return c.toDataURL('image/jpeg', 0.75); }
  catch { return null; }
}

// Captura la región central (equivalente al recuadro .scan-box) y la
// preprocesa para mejorar el OCR: recorte, escalado, escala de grises y umbral.
export function captureScanRegion(videoEl, canvas, box = SCAN_BOX) {
  if (!videoEl.videoWidth || !videoEl.videoHeight) throw new Error('La cámara aún no está lista.');

  // Recorta EXACTAMENTE el recuadro visible del frame crudo.
  const { sx, sy, sw, sh } = coverCrop(videoEl, box);

  // Escalar para dar más resolución al OCR.
  const scale = Math.max(1, Math.round(900 / sw));
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  canvas.width = dw;
  canvas.height = dh;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, dw, dh);

  // Escala de grises + histograma.
  const img = ctx.getImageData(0, 0, dw, dh);
  const d = img.data;
  const gray = new Uint8ClampedArray(d.length / 4);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[j] = g;
    hist[g]++;
  }

  // Umbral de Otsu (separa texto/fondo de forma óptima, robusto a brillo).
  const threshold = otsu(hist, gray.length);

  // Auto-polaridad: el código del reverso es BLANCO sobre OSCURO. Tesseract
  // lee mejor texto oscuro sobre claro, así que detectamos qué clase es la
  // minoría (el texto) y la pintamos en negro sobre blanco.
  let below = 0;
  for (let j = 0; j < gray.length; j++) if (gray[j] < threshold) below++;
  const darkIsText = below <= gray.length - below; // texto = clase minoritaria
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const isDark = gray[j] < threshold;
    const isText = darkIsText ? isDark : !isDark;
    const v = isText ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Umbral de Otsu sobre un histograma de 256 niveles.
function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = 0, threshold = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; threshold = i; }
  }
  return threshold;
}
