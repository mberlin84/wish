// OCR del código impreso usando Tesseract.js (cargado globalmente vía CDN).
// El código vive en el reverso de la lámina (ej. "KOR 8"): prefijo de país
// + número. recognize() devuelve el texto crudo; bestCode() lo interpreta y,
// si se le pasa el set de códigos válidos del álbum, lo corrige al más cercano.

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
        // Código = letras (país) + dígitos. Sin minúsculas ni símbolos.
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ',
        tessedit_pageseg_mode: '7', // una sola línea de texto
      });
      return worker;
    })();
  }
  return workerPromise;
}

// Reconoce texto en un canvas. Devuelve { text, confidence }.
export async function recognize(canvas, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return {
    text: (data.text || '').trim(),
    confidence: Math.round(data.confidence || 0),
  };
}

// ---- Interpretación del texto OCR ---------------------------------------

// Palabras del reverso que NO son el código (logo, licencia, etc.).
const STOP = new Set([
  'FIFA', 'WORLD', 'CUP', 'PANINI', 'OFFICIAL', 'LICENSED', 'PRODUCT',
  'MADE', 'BRAZIL', 'WWW', 'COM', 'GROUP', 'LICENCE', 'UNDER',
]);

// Caracteres que el OCR confunde con frecuencia (misma "forma").
const CONFUSE = [
  ['0', 'O', 'Q', 'D'], ['1', 'I', 'L'], ['2', 'Z'], ['4', 'A'],
  ['5', 'S'], ['6', 'G'], ['7', 'T'], ['8', 'B'],
];
const CLASS = new Map();
CONFUSE.forEach((g, i) => g.forEach((c) => CLASS.set(c, i)));
function sameShape(a, b) {
  if (a === b) return true;
  const ca = CLASS.get(a);
  return ca != null && ca === CLASS.get(b);
}

// Distancia de edición donde sustituir un carácter por otro "de la misma
// forma" cuesta 0 (ej. O↔0, S↔5). Inserciones/borrados cuestan 1.
function shapeDistance(a, b) {
  const m = a.length, n = b.length;
  const prev = new Array(n + 1);
  const cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + (sameShape(a[i - 1], b[j - 1]) ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

// Encuentra el código válido más parecido a `s` (tolerando confusiones).
// Devuelve { code, cost } o null si nada está suficientemente cerca.
function nearestValid(s, validCodes) {
  if (validCodes.has(s)) return { code: s, cost: 0 };
  let best = null;
  for (const code of validCodes) {
    if (Math.abs(code.length - s.length) > 1) continue;
    const cost = shapeDistance(s, code);
    if (best === null || cost < best.cost) {
      best = { code, cost };
      if (cost === 0) break;
    }
  }
  // Coincidencia exacta siempre; con 1 error solo si el candidato tiene cuerpo
  // suficiente (≥4 chars), para no convertir un "KOR" suelto en "KOR1".
  if (!best) return null;
  if (best.cost === 0) return best;
  if (best.cost <= 1 && s.length >= 4) return best;
  return null;
}

// Genera los strings candidatos a partir del texto OCR: cada token útil y
// las concatenaciones de tokens adyacentes (para unir "KOR" + "8" → "KOR8").
function candidates(text) {
  const up = (text || '').toUpperCase();
  const tokens = (up.match(/[A-Z0-9]+/g) || []).filter(
    (t) => !STOP.has(t) && t !== '00' && !/^\d{4,}$/.test(t), // fuera año/ID largo
  );
  const out = new Set();
  for (let i = 0; i < tokens.length; i++) {
    out.add(tokens[i]);
    if (i + 1 < tokens.length) out.add(tokens[i] + tokens[i + 1]);
  }
  return [...out].filter((c) => c.length >= 2 && c.length <= 6);
}

// Estructura "prefijo de letras + número" sin álbum (último recurso).
function structural(s) {
  const m = s.match(/^([A-Z]{2,4})([0-9]{1,3})$/);
  return m ? m[0] : null;
}

// Interpreta el texto OCR y devuelve la mejor lectura:
//   { code, valid, cost }  — valid=true si coincide con el álbum.
// `validCodes` (Set de códigos normalizados) es opcional pero recomendado:
// permite corregir O↔0, S↔5, etc. y descartar lecturas que no existen.
export function bestCode(text, validCodes = null) {
  const cands = candidates(text);
  if (!cands.length) return null;

  if (validCodes && validCodes.size) {
    let best = null;
    for (const c of cands) {
      const m = nearestValid(c, validCodes);
      if (m && (best === null || m.cost < best.cost)) best = { code: m.code, valid: true, cost: m.cost };
      if (best && best.cost === 0) break;
    }
    if (best) return best;
  }

  // Sin álbum (o sin coincidencia): estructura prefijo+número. Como último
  // recurso, el candidato con dígitos más largo (todo código real lleva número,
  // así que descartamos los que no tienen ninguno).
  for (const c of cands) {
    const s = structural(c);
    if (s) return { code: s, valid: false, cost: 1 };
  }
  const withDigits = cands.filter((c) => /\d/.test(c))
    .sort((a, b) => (b.match(/\d/g) || []).length - (a.match(/\d/g) || []).length || b.length - a.length);
  return withDigits[0] ? { code: withDigits[0], valid: false, cost: 2 } : null;
}

export async function terminate() {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
