import express from 'express';
import { query } from '../db.js';
import { authRequired } from '../auth.js';

const router = express.Router();

const norm = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');

// Colección completa del usuario { code: count }.
router.get('/', authRequired, async (req, res) => {
  const r = await query('SELECT code, count FROM stickers WHERE user_id = $1 AND count > 0', [req.user.id]);
  const owned = {};
  r.rows.forEach((x) => { owned[x.code] = x.count; });
  res.json({ owned });
});

// Suma una unidad (al re-agregar una que ya tienes, queda como repetida).
router.post('/add', authRequired, async (req, res) => {
  const code = norm(req.body?.code);
  if (!code) return res.status(400).json({ error: 'Código requerido.' });
  const r = await query(
    `INSERT INTO stickers (user_id, code, count) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, code) DO UPDATE SET count = stickers.count + 1, updated_at = now()
     RETURNING count`,
    [req.user.id, code]
  );
  res.json({ code, count: r.rows[0].count });
});

// Resta una unidad.
router.post('/remove', authRequired, async (req, res) => {
  const code = norm(req.body?.code);
  if (!code) return res.status(400).json({ error: 'Código requerido.' });
  const r = await query(
    'UPDATE stickers SET count = GREATEST(count - 1, 0), updated_at = now() WHERE user_id = $1 AND code = $2 RETURNING count',
    [req.user.id, code]
  );
  const count = r.rows[0]?.count ?? 0;
  if (count <= 0) await query('DELETE FROM stickers WHERE user_id = $1 AND code = $2', [req.user.id, code]);
  res.json({ code, count });
});

// Fija una cantidad exacta (0 = eliminar).
router.post('/set', authRequired, async (req, res) => {
  const code = norm(req.body?.code);
  const count = Math.max(0, parseInt(req.body?.count, 10) || 0);
  if (!code) return res.status(400).json({ error: 'Código requerido.' });
  if (count === 0) {
    await query('DELETE FROM stickers WHERE user_id = $1 AND code = $2', [req.user.id, code]);
  } else {
    await query(
      `INSERT INTO stickers (user_id, code, count) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, code) DO UPDATE SET count = $3, updated_at = now()`,
      [req.user.id, code, count]
    );
  }
  res.json({ code, count });
});

export default router;
