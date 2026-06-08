// Almacenamiento y modelo de datos del álbum (localStorage).

const KEY = 'misLaminas_v1';

// Set por defecto: Mundial 2026 — 980 láminas (números corridos 1 a 980).
export function defaultAlbum() {
  return {
    name: 'Mundial 2026',
    sections: [
      { id: 'base', name: 'Láminas', prefix: '', from: 1, to: 980 },
    ],
  };
}

function emptyState() {
  return {
    album: defaultAlbum(),
    owned: {}, // { codeNormalizado: cantidad }
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const data = JSON.parse(raw);
    return {
      album: data.album || defaultAlbum(),
      owned: data.owned || {},
    };
  } catch (e) {
    console.warn('No se pudo leer el almacenamiento, empezando vacío.', e);
    return emptyState();
  }
}

export function save(state) {
  localStorage.setItem(KEY, JSON.stringify({ album: state.album, owned: state.owned }));
}

// Normaliza un código: mayúsculas, sin espacios.
export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

// Genera el código completo de una lámina a partir de su sección y número.
export function codeFor(section, n) {
  return normalizeCode((section.prefix || '') + n);
}

// Devuelve todos los códigos válidos del álbum, en orden.
export function allCodes(album) {
  const codes = [];
  for (const s of album.sections) {
    const from = Math.min(s.from, s.to);
    const to = Math.max(s.from, s.to);
    for (let n = from; n <= to; n++) {
      codes.push(codeFor(s, n));
    }
  }
  return codes;
}

// Conjunto de códigos válidos para validación rápida.
export function albumCodeSet(album) {
  return new Set(allCodes(album));
}

// ¿El código pertenece al álbum?
export function isInAlbum(album, code) {
  return albumCodeSet(album).has(normalizeCode(code));
}

// Calcula las listas derivadas a partir del estado.
export function computeLists(state) {
  const codes = allCodes(state.album);
  const set = new Set(codes);
  const have = [];
  const missing = [];
  const repeated = []; // { code, extra }
  let extras = 0;

  for (const code of codes) {
    const count = state.owned[code] || 0;
    if (count > 0) have.push(code);
    else missing.push(code);
    if (count > 1) {
      const extra = count - 1;
      repeated.push({ code, extra });
      extras += extra;
    }
  }

  // Códigos poseídos que NO pertenecen al álbum (por si se escaneó algo fuera del set).
  const foreign = [];
  for (const code of Object.keys(state.owned)) {
    if (!set.has(code) && state.owned[code] > 0) {
      foreign.push({ code, count: state.owned[code] });
    }
  }

  return { have, missing, repeated, extras, foreign, total: codes.length };
}
