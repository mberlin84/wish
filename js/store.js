// Almacenamiento y modelo de datos del álbum (localStorage).

const KEY = 'misLaminas_v1';

// Selecciones del Mundial 2026 (48). Código FIFA, nombre en español e ISO-2
// para la bandera (flagcdn). Es la fuente única: el álbum y stickers.js la usan.
export const WC2026_TEAMS = [
  { code: 'ALG', name: 'Argelia', iso2: 'dz' },
  { code: 'ARG', name: 'Argentina', iso2: 'ar' },
  { code: 'AUS', name: 'Australia', iso2: 'au' },
  { code: 'AUT', name: 'Austria', iso2: 'at' },
  { code: 'BEL', name: 'Bélgica', iso2: 'be' },
  { code: 'BIH', name: 'Bosnia y Herzegovina', iso2: 'ba' },
  { code: 'BRA', name: 'Brasil', iso2: 'br' },
  { code: 'CAN', name: 'Canadá', iso2: 'ca' },
  { code: 'CPV', name: 'Cabo Verde', iso2: 'cv' },
  { code: 'COL', name: 'Colombia', iso2: 'co' },
  { code: 'COD', name: 'RD del Congo', iso2: 'cd' },
  { code: 'CRO', name: 'Croacia', iso2: 'hr' },
  { code: 'CUW', name: 'Curazao', iso2: 'cw' },
  { code: 'CZE', name: 'Chequia', iso2: 'cz' },
  { code: 'ECU', name: 'Ecuador', iso2: 'ec' },
  { code: 'EGY', name: 'Egipto', iso2: 'eg' },
  { code: 'ENG', name: 'Inglaterra', iso2: 'gb-eng' },
  { code: 'FRA', name: 'Francia', iso2: 'fr' },
  { code: 'GER', name: 'Alemania', iso2: 'de' },
  { code: 'GHA', name: 'Ghana', iso2: 'gh' },
  { code: 'HAI', name: 'Haití', iso2: 'ht' },
  { code: 'IRN', name: 'Irán', iso2: 'ir' },
  { code: 'IRQ', name: 'Irak', iso2: 'iq' },
  { code: 'CIV', name: 'Costa de Marfil', iso2: 'ci' },
  { code: 'JPN', name: 'Japón', iso2: 'jp' },
  { code: 'JOR', name: 'Jordania', iso2: 'jo' },
  { code: 'MEX', name: 'México', iso2: 'mx' },
  { code: 'MAR', name: 'Marruecos', iso2: 'ma' },
  { code: 'NED', name: 'Países Bajos', iso2: 'nl' },
  { code: 'NZL', name: 'Nueva Zelanda', iso2: 'nz' },
  { code: 'NOR', name: 'Noruega', iso2: 'no' },
  { code: 'PAN', name: 'Panamá', iso2: 'pa' },
  { code: 'PAR', name: 'Paraguay', iso2: 'py' },
  { code: 'POR', name: 'Portugal', iso2: 'pt' },
  { code: 'QAT', name: 'Catar', iso2: 'qa' },
  { code: 'KSA', name: 'Arabia Saudita', iso2: 'sa' },
  { code: 'SCO', name: 'Escocia', iso2: 'gb-sct' },
  { code: 'SEN', name: 'Senegal', iso2: 'sn' },
  { code: 'RSA', name: 'Sudáfrica', iso2: 'za' },
  { code: 'KOR', name: 'Corea del Sur', iso2: 'kr' },
  { code: 'ESP', name: 'España', iso2: 'es' },
  { code: 'SWE', name: 'Suecia', iso2: 'se' },
  { code: 'SUI', name: 'Suiza', iso2: 'ch' },
  { code: 'TUN', name: 'Túnez', iso2: 'tn' },
  { code: 'TUR', name: 'Turquía', iso2: 'tr' },
  { code: 'URU', name: 'Uruguay', iso2: 'uy' },
  { code: 'USA', name: 'Estados Unidos', iso2: 'us' },
  { code: 'UZB', name: 'Uzbekistán', iso2: 'uz' },
];

// Álbum oficial Panini Mundial 2026: 48 selecciones × 20 (escudo + foto de
// equipo + 18 jugadores), numeradas por equipo (KOR 1…KOR 20), más 20 láminas
// especiales (Introducción + FIFA Museum). Total 980. Todo editable.
export function defaultAlbum() {
  const teams = WC2026_TEAMS.map((t) => ({
    id: t.code.toLowerCase(), name: t.name, prefix: t.code, from: 1, to: 20,
  }));
  return {
    name: 'Mundial 2026',
    sections: [
      ...teams,
      { id: 'fwc', name: 'Especiales (Intro + FIFA Museum)', prefix: 'FWC', from: 1, to: 20 },
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
