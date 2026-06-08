import express from 'express';
import { pool, query } from '../db.js';
import { authRequired } from '../auth.js';

const router = express.Router();
const ALBUM_NAME = process.env.ALBUM_NAME || 'Mundial 2026';

// Álbum global (compartido por todos para que los códigos coincidan en los trueques).
router.get('/', async (req, res) => {
  const r = await query(
    'SELECT id, name, prefix, from_n AS "from", to_n AS "to" FROM album_sections ORDER BY sort_order, id'
  );
  res.json({ name: ALBUM_NAME, sections: r.rows });
});

// Reemplaza la definición de secciones (requiere sesión).
router.put('/', authRequired, async (req, res) => {
  const { sections } = req.body || {};
  if (!Array.isArray(sections) || !sections.length) {
    return res.status(400).json({ error: 'Se requiere al menos una sección.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM album_sections');
    let i = 0;
    for (const s of sections) {
      await client.query(
        'INSERT INTO album_sections (name, prefix, from_n, to_n, sort_order) VALUES ($1, $2, $3, $4, $5)',
        [s.name || 'Sección', s.prefix || '', parseInt(s.from, 10) || 0, parseInt(s.to, 10) || 0, i++]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Error al guardar el álbum.' });
  } finally {
    client.release();
  }
});

export default router;
