// Modelo visual de las láminas: convierte un código (p. ej. "273", "E5", "ARG13")
// en una "carta de cromo" con número estilo dorsal, color por sección, bandera
// (si la sección es de un país) y, si existe, la foto real capturada con la cámara.

import { normalizeCode, WC2026_TEAMS } from './store.js';

// ---- Fotos capturadas por el usuario (legalmente limpias: son SU foto) ----
// Se guardan aparte de la colección para no arriesgar el cupo de esa clave.
const PHOTO_KEY = 'misLaminas_photos_v1';
const MAX_PHOTOS = 80; // tope para no reventar el cupo de localStorage (~5MB)

function loadPhotos() {
  try { return JSON.parse(localStorage.getItem(PHOTO_KEY)) || {}; }
  catch { return {}; }
}
function savePhotos(map) {
  try { localStorage.setItem(PHOTO_KEY, JSON.stringify(map)); return true; }
  catch { return false; }
}

export function getPhoto(code) {
  return loadPhotos()[normalizeCode(code)] || null;
}

// Guarda (o reemplaza) la foto de un código. Si se llena el cupo, descarta las
// más antiguas hasta que entre. Devuelve true si quedó guardada.
export function setPhoto(code, dataUrl) {
  if (!dataUrl) return false;
  const c = normalizeCode(code);
  const map = loadPhotos();
  map[c] = dataUrl;
  let keys = Object.keys(map);
  while (keys.length > MAX_PHOTOS) { delete map[keys.shift()]; }
  if (savePhotos(map)) return true;
  // Cupo lleno: ir soltando las más viejas y reintentar.
  keys = Object.keys(map);
  while (keys.length) {
    delete map[keys.shift()];
    if (savePhotos(map)) return !!map[c];
  }
  return false;
}

export function removePhoto(code) {
  const map = loadPhotos();
  delete map[normalizeCode(code)];
  savePhotos(map);
}

// ---- Parseo de código: prefijo de letras + número ----
export function parseCode(code) {
  const c = normalizeCode(code);
  const m = c.match(/^([A-Z]*)(\d+)$/);
  if (!m) return { prefix: c, num: null, raw: c };
  return { prefix: m[1], num: parseInt(m[2], 10), raw: c };
}

// ---- Mapa de selecciones: código FIFA (3 letras) -> [país, ISO-2] ----
// Generado desde la lista única WC2026_TEAMS (store.js). Si el álbum se
// configura por países (formato real Panini, p. ej. sección KOR 1-20),
// la carta muestra la bandera sola.
const COUNTRIES = Object.fromEntries(
  WC2026_TEAMS.map((t) => [t.code, [t.name, t.iso2]]),
);

export function countryFor(prefix) {
  const info = COUNTRIES[prefix];
  return info ? { name: info[0], iso2: info[1] } : null;
}

function flagUrl(iso2) {
  return `https://flagcdn.com/${iso2}.svg`;
}

// Rol de la lámina dentro de una selección (formato Panini: 20 por equipo).
function roleLabel(prefix, num) {
  if (!countryFor(prefix)) return null;
  if (num === 1) return 'Escudo';
  if (num === 13) return 'Equipo';
  return `Jugador ${num}`;
}

// ¿La sección es "especial / foil"? (oro brillante)
function isSpecial(section) {
  if (!section) return false;
  const p = (section.prefix || '').toUpperCase();
  const n = (section.name || '').toLowerCase();
  return p === 'E' || /espec|foil|leyend|legend|brillo/.test(n);
}

// Encuentra la sección del álbum a la que pertenece un código.
export function sectionFor(album, code) {
  const { prefix, num } = parseCode(code);
  if (!album || !Array.isArray(album.sections)) return null;
  for (const s of album.sections) {
    const sp = normalizeCode(s.prefix || '');
    if (sp !== prefix) continue;
    const lo = Math.min(s.from, s.to), hi = Math.max(s.from, s.to);
    if (num != null && num >= lo && num <= hi) return s;
  }
  return null;
}

// Pelota de fútbol como marca de agua (SVG inline válido, sin dependencias).
const BALL_SVG =
  '<svg class="scard__ball" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9.3"/>' +
  '<path d="M12 6.6l3.3 2.4-1.25 3.9h-4.1L8.7 9 12 6.6Z"/>' +
  '<path d="M12 6.6V2.9M14 12.9l3.4-1.1 1.9 2M10 12.9l-3.4-1.1-1.9 2M13.85 16.6l1.25 3.4M10.15 16.6L8.9 20"/>' +
  '</svg>';

// Crea la carta de cromo (elemento DOM). opts: { count, state, album, onTap, compact }
// state: 'have' | 'missing' | 'repeated' | 'foreign'
export function createStickerCard(code, opts = {}) {
  const { count = 0, state = 'missing', album = null, onTap = null, compact = false } = opts;
  const { prefix, num, raw } = parseCode(code);
  const section = sectionFor(album, code);
  const country = countryFor(prefix);
  const special = isSpecial(section);
  const photo = getPhoto(code);

  const card = document.createElement('button');
  card.type = 'button';
  card.className = `scard scard--${state}` +
    (special ? ' scard--foil' : '') +
    (compact ? ' scard--compact' : '') +
    (photo ? ' scard--photo' : '') +
    (country ? ' scard--team' : '');
  if (prefix) card.dataset.prefix = prefix;

  const role = roleLabel(prefix, num);
  const topLabel = country ? country.name : (section ? section.name : (prefix ? prefix : 'Lámina'));
  const numText = num != null ? String(num) : raw;

  const parts = [];
  parts.push('<span class="scard__sheen" aria-hidden="true"></span>');
  if (photo) {
    parts.push(`<img class="scard__img" src="${photo}" alt="Foto de la lámina ${raw}" loading="lazy" decoding="async" />`);
  } else if (country) {
    parts.push(`<img class="scard__flag" src="${flagUrl(country.iso2)}" alt="" loading="lazy" decoding="async" />`);
    parts.push(BALL_SVG);
  } else {
    parts.push(BALL_SVG);
  }

  parts.push('<span class="scard__grad" aria-hidden="true"></span>');
  parts.push(`<span class="scard__top">${escapeHtml(topLabel)}</span>`);
  parts.push(`<span class="scard__num">${escapeHtml(numText)}</span>`);
  parts.push(`<span class="scard__role">${escapeHtml(role || (prefix && num != null ? `#${num}` : ' '))}</span>`);

  if (state === 'repeated' && count > 1) {
    parts.push(`<span class="scard__badge">×${count}</span>`);
  } else if (state === 'have' && count > 1) {
    parts.push(`<span class="scard__badge scard__badge--soft">×${count}</span>`);
  } else if (state === 'foreign') {
    parts.push('<span class="scard__badge scard__badge--warn">?</span>');
  } else if (state === 'have') {
    parts.push('<span class="scard__check" aria-hidden="true">✓</span>');
  }

  card.innerHTML = parts.join('');

  const aria = `Lámina ${raw}` + (topLabel ? `, ${topLabel}` : '') +
    (state === 'have' ? ', la tienes' : state === 'missing' ? ', te falta' :
     state === 'repeated' ? `, repetida ${count}` : '');
  card.setAttribute('aria-label', aria);

  if (onTap) card.addEventListener('click', () => onTap(code));
  return card;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
