// Manejo de la cámara y recorte/preprocesado del recuadro de escaneo.

let stream = null;

export async function start(videoEl) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Este navegador no permite acceder a la cámara.');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
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

// Captura la región central (equivalente al recuadro .scan-box) y la
// preprocesa para mejorar el OCR: recorte, escalado, escala de grises y umbral.
export function captureScanRegion(videoEl, canvas) {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) throw new Error('La cámara aún no está lista.');

  // Mismas proporciones que .scan-box en el CSS.
  const boxLeft = 0.12, boxRight = 0.12, boxTop = 0.38, boxHeight = 0.22;
  const sx = vw * boxLeft;
  const sw = vw * (1 - boxLeft - boxRight);
  const sy = vh * boxTop;
  const sh = vh * boxHeight;

  // Escalar para dar más resolución al OCR.
  const scale = Math.max(1, Math.round(900 / sw));
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  canvas.width = dw;
  canvas.height = dh;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, dw, dh);

  // Escala de grises + umbral adaptativo simple.
  const img = ctx.getImageData(0, 0, dw, dh);
  const d = img.data;
  let sum = 0;
  const gray = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    gray[j] = g;
    sum += g;
  }
  const mean = sum / gray.length;
  const threshold = mean * 0.9; // ligeramente por debajo de la media
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = gray[j] > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
