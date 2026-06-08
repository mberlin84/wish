import express from 'express';
import { query } from '../db.js';
import { authRequired } from '../auth.js';

const router = express.Router();
const MAX_LEN = 2000;

// Lista de conversaciones: el otro usuario, último mensaje y nº de no leídos.
router.get('/conversations', authRequired, async (req, res) => {
  const me = req.user.id;
  const sql = `
    WITH convo AS (
      SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_id,
             body, created_at, sender_id
      FROM messages
      WHERE sender_id = $1 OR recipient_id = $1
    ),
    last AS (
      SELECT DISTINCT ON (other_id) other_id, body, created_at, sender_id
      FROM convo
      ORDER BY other_id, created_at DESC
    ),
    unread AS (
      SELECT sender_id AS other_id, COUNT(*) AS cnt
      FROM messages
      WHERE recipient_id = $1 AND read_at IS NULL
      GROUP BY sender_id
    )
    SELECT u.id, u.username, u.city,
           l.body AS last_body, l.created_at AS last_at, l.sender_id AS last_sender,
           COALESCE(un.cnt, 0)::int AS unread
    FROM last l
    JOIN users u ON u.id = l.other_id
    LEFT JOIN unread un ON un.other_id = l.other_id
    ORDER BY l.created_at DESC
  `;
  const r = await query(sql, [me]);
  res.json({ conversations: r.rows });
});

// Total de mensajes no leídos (para el badge de la pestaña).
router.get('/unread-count', authRequired, async (req, res) => {
  const r = await query(
    'SELECT COUNT(*)::int AS cnt FROM messages WHERE recipient_id = $1 AND read_at IS NULL',
    [req.user.id]
  );
  res.json({ count: r.rows[0].cnt });
});

// Conversación con un usuario concreto (marca como leídos los recibidos).
router.get('/with/:userId', authRequired, async (req, res) => {
  const me = req.user.id;
  const other = parseInt(req.params.userId, 10);
  if (!other || other === me) return res.status(400).json({ error: 'Usuario inválido.' });

  const u = await query('SELECT id, username, city FROM users WHERE id = $1', [other]);
  if (!u.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado.' });

  await query(
    'UPDATE messages SET read_at = now() WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL',
    [me, other]
  );

  const r = await query(
    `SELECT id, sender_id, recipient_id, body, created_at
     FROM messages
     WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
     ORDER BY created_at ASC
     LIMIT 500`,
    [me, other]
  );
  res.json({ user: u.rows[0], messages: r.rows });
});

// Enviar un mensaje a un usuario.
router.post('/with/:userId', authRequired, async (req, res) => {
  const me = req.user.id;
  const other = parseInt(req.params.userId, 10);
  const body = String(req.body?.body || '').trim();
  if (!other || other === me) return res.status(400).json({ error: 'Usuario inválido.' });
  if (!body) return res.status(400).json({ error: 'El mensaje está vacío.' });
  if (body.length > MAX_LEN) return res.status(400).json({ error: 'Mensaje demasiado largo.' });

  const exists = await query('SELECT 1 FROM users WHERE id = $1', [other]);
  if (!exists.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const r = await query(
    `INSERT INTO messages (sender_id, recipient_id, body) VALUES ($1, $2, $3)
     RETURNING id, sender_id, recipient_id, body, created_at`,
    [me, other, body]
  );
  res.json({ message: r.rows[0] });
});

export default router;
