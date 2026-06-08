import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { signToken } from '../auth.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { email, username, password } = req.body || {};
  if (!email || !username || !password) {
    return res.status(400).json({ error: 'Faltan datos (email, usuario y contraseña).' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await query(
      'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id, email, username, lat, lng, city',
      [email.toLowerCase().trim(), username.trim(), hash]
    );
    const user = r.rows[0];
    res.json({ token: signToken(user), user });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ese email ya está registrado.' });
    console.error(e);
    res.status(500).json({ error: 'Error al registrar.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Faltan datos.' });
  try {
    const r = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas.' });
    res.json({
      token: signToken(user),
      user: { id: user.id, email: user.email, username: user.username, lat: user.lat, lng: user.lng, city: user.city },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

export default router;
