// OCR del número impreso usando Tesseract.js (cargado globalmente vía CDN).

let workerPromise = null;

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (typeof Tesseract === 'undefined') {
        throw new Error('Tesseract no está disponible (¿sin conexión la primera vez?).');
      }
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => { if (onProgress) onProgress(m); },
      });
      await worker.setParameters({
        // Las láminas usan número y a veces un prefijo/letra.
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        tessedit_pageseg_mode: '7', // una sola línea de texto
      });
      return worker;
    })();
  }
  return workerPromise;
}

// Reconoce texto en un canvas. Devuelve { text, candidate, confidence }.
export async function recognize(canvas, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  const text = (data.text || '').trim();
  return {
    text,
    candidate: extractCandidate(text),
    confidence: Math.round(data.confidence || 0),
  };
}

// Extrae el candidato más probable: la secuencia alfanumérica más larga,
// priorizando dígitos.
export function extractCandidate(text) {
  if (!text) return '';
  const cleaned = text.toUpperCase();
  // Tokens alfanuméricos.
  const tokens = cleaned.match(/[A-Z0-9]+/g) || [];
  if (!tokens.length) return '';
  // Preferir tokens que contengan dígitos; entre esos, el que tenga más dígitos.
  const digitCount = (t) => (t.match(/\d/g) || []).length;
  tokens.sort((a, b) => digitCount(b) - digitCount(a) || b.length - a.length);
  return tokens[0];
}

export async function terminate() {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
