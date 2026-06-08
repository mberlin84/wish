// Capa de comunicación con el backend (Express + PostgreSQL).
// El token de sesión y la URL base se guardan en localStorage.

const TOKEN_KEY = 'laminas_token';
const BASE_KEY = 'laminas_apiBase';

export function getApiBase() {
  return localStorage.getItem(BASE_KEY) || '';
}
export function setApiBase(url) {
  if (url) localStorage.setItem(BASE_KEY, url.replace(/\/$/, ''));
  else localStorage.removeItem(BASE_KEY);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}
export function isLoggedIn() {
  return !!getToken();
}

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(getApiBase() + '/api' + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error('No se pudo conectar con el servidor.');
  }

  if (res.status === 401) {
    setToken(null);
    throw new Error('Sesión expirada. Inicia sesión de nuevo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}

export const api = {
  register: (body) => req('/auth/register', { method: 'POST', body }),
  login: (body) => req('/auth/login', { method: 'POST', body }),
  me: () => req('/me'),
  setLocation: (body) => req('/me/location', { method: 'PUT', body }),
  getAlbum: () => req('/album'),
  saveAlbum: (sections) => req('/album', { method: 'PUT', body: { sections } }),
  getCollection: () => req('/collection'),
  add: (code) => req('/collection/add', { method: 'POST', body: { code } }),
  remove: (code) => req('/collection/remove', { method: 'POST', body: { code } }),
  setCount: (code, count) => req('/collection/set', { method: 'POST', body: { code, count } }),
  trades: () => req('/trades'),
};
