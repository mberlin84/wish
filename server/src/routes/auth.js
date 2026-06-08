import express from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { signToken } from '../auth.js';
import { sendMagicLink } from '../mailer.js';

const router = express.Router();

const TOKEN_TTL_MIN = 15;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Hosts de confianza para construir enlaces cuando no hay APP_URL (solo dev).
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Base pública para construir el enlace mágico.
// SEGURIDAD: nunca confiamos en el header Host para un enlace con credenciales.
// - Si hay APP_URL, se usa siempre (recomendado en producción).
// - Si no, solo se acepta el host si está en la allowlist (localhost por defecto);
//   así un atacante no puede forjar `Host:` para desviar el enlace de la víctima.
function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = (req.get('host') || '').toLowerCase();
  const hostname = host.split(':')[0];
  if (!ALLOWED_HOSTS.includes(hostname)) {
    throw new Error('Host no permitido para generar enlaces. Configura APP_URL.');
  }
  const proto = req.protocol === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

// 1) Pedir enlace mágico: genera token de un solo uso y lo envía por correo.
router.post('/magic/request', async (req, res) => {
  const email = String((req.body && req.body.email) || '').toLowerCase().trim();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Escribe un correo válido.' });
  }
  try {
    await query('DELETE FROM login_tokens WHERE expires_at < now()'); // limpieza oportunista
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000);
    await query(
      'INSERT INTO login_tokens (token, email, expires_at) VALUES ($1, $2, $3)',
      [token, email, expires]
    );
    const link = `${appUrl(req)}/api/auth/magic/verify?token=${token}`;
    const result = await sendMagicLink(email, link);
    // No revelamos si el correo existe; la cuenta se crea al verificar.
    res.json({ ok: true, dev: !!result.dev });
  } catch (e) {
    console.error('magic/request:', e.message);
    res.status(500).json({ error: 'No se pudo enviar el enlace. Inténtalo de nuevo.' });
  }
});

// 2) Verificar enlace (lo abre el navegador desde el correo): valida, crea/halla
//    el usuario, emite la sesión y redirige a la app con el token en el fragmento.
router.get('/magic/verify', async (req, res) => {
  const token = String(req.query.token || '');
  const base = appUrl(req);
  const fail = (reason) => res.redirect(302, `${base}/#login=${reason}`);
  if (!token) return fail('error');
  try {
    const r = await query('SELECT * FROM login_tokens WHERE token = $1', [token]);
    const row = r.rows[0];
    if (!row) return fail('invalid');
    if (row.used_at) return fail('used');
    if (new Date(row.expires_at) < new Date()) return fail('expired');

    await query('UPDATE login_tokens SET used_at = now() WHERE token = $1', [token]);

    const email = row.email;
    let u = await query('SELECT id, email, username, lat, lng, city FROM users WHERE email = $1', [email]);
    let user = u.rows[0];
    if (!user) {
      const uname = (email.split('@')[0] || 'jugador').slice(0, 24);
      const ins = await query(
        'INSERT INTO users (email, username) VALUES ($1, $2) RETURNING id, email, username, lat, lng, city',
        [email, uname]
      );
      user = ins.rows[0];
    }
    const jwtToken = signToken(user);
    return res.redirect(302, `${base}/#session=${jwtToken}`);
  } catch (e) {
    console.error('magic/verify:', e.message);
    return fail('error');
  }
});

export default router;
