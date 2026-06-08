import express from 'express';
import { query } from '../db.js';
import { authRequired } from '../auth.js';

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  const r = await query('SELECT id, email, username, lat, lng, city FROM users WHERE id = $1', [req.user.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json({ user: r.rows[0] });
});

router.put('/location', authRequired, async (req, res) => {
  const { lat, lng, city } = req.body || {};
  const latVal = lat === undefined || lat === null || lat === '' ? null : Number(lat);
  const lngVal = lng === undefined || lng === null || lng === '' ? null : Number(lng);
  const r = await query(
    'UPDATE users SET lat = $1, lng = $2, city = $3 WHERE id = $4 RETURNING id, email, username, lat, lng, city',
    [latVal, lngVal, city ? String(city).trim() : null, req.user.id]
  );
  res.json({ user: r.rows[0] });
});

export default router;
