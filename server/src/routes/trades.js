import express from 'express';
import { query } from '../db.js';
import { authRequired } from '../auth.js';

const router = express.Router();

// Distancia en km entre dos puntos (fórmula del haversine).
function haversineKm(a, b) {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Encuentra posibles trueques:
//  - theyGive: láminas que el otro tiene repetidas y a mí me faltan.
//  - iGive:    mis repetidas que al otro le faltan.
router.get('/', authRequired, async (req, res) => {
  const meId = req.user.id;
  const meRow = (await query('SELECT lat, lng FROM users WHERE id = $1', [meId])).rows[0] || {};

  const sql = `
    WITH album_codes AS (
      SELECT (prefix || g) AS code
      FROM album_sections,
           LATERAL generate_series(LEAST(from_n, to_n), GREATEST(from_n, to_n)) AS g
    ),
    my AS (SELECT code, count FROM stickers WHERE user_id = $1),
    my_have AS (SELECT code FROM my WHERE count > 0),
    my_dups AS (SELECT code FROM my WHERE count > 1),
    my_missing AS (SELECT code FROM album_codes WHERE code NOT IN (SELECT code FROM my_have)),
    they_give AS (
      SELECT s.user_id, array_agg(s.code ORDER BY s.code) AS codes
      FROM stickers s
      JOIN my_missing m ON m.code = s.code
      WHERE s.user_id <> $1 AND s.count > 1
      GROUP BY s.user_id
    ),
    i_give AS (
      SELECT u.id AS user_id, array_agg(d.code ORDER BY d.code) AS codes
      FROM users u
      CROSS JOIN my_dups d
      WHERE u.id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM stickers s2
          WHERE s2.user_id = u.id AND s2.code = d.code AND s2.count > 0
        )
      GROUP BY u.id
    )
    SELECT u.id, u.username, u.city, u.lat, u.lng,
           COALESCE(tg.codes, '{}') AS they_give,
           COALESCE(ig.codes, '{}') AS i_give
    FROM users u
    LEFT JOIN they_give tg ON tg.user_id = u.id
    LEFT JOIN i_give ig ON ig.user_id = u.id
    WHERE u.id <> $1 AND (tg.codes IS NOT NULL OR ig.codes IS NOT NULL)
  `;

  try {
    const r = await query(sql, [meId]);
    const partners = r.rows.map((row) => {
      const dist = haversineKm({ lat: meRow.lat, lng: meRow.lng }, { lat: row.lat, lng: row.lng });
      return {
        id: row.id,
        username: row.username,
        city: row.city,
        distanceKm: dist != null ? Math.round(dist * 10) / 10 : null,
        theyGive: row.they_give || [],
        iGive: row.i_give || [],
      };
    });

    // Orden: primero trueques mutuos, luego por cercanía, luego por nº de coincidencias.
    partners.sort((a, b) => {
      const aMutual = a.theyGive.length > 0 && a.iGive.length > 0 ? 1 : 0;
      const bMutual = b.theyGive.length > 0 && b.iGive.length > 0 ? 1 : 0;
      if (aMutual !== bMutual) return bMutual - aMutual;
      if (a.distanceKm != null && b.distanceKm != null && a.distanceKm !== b.distanceKm) {
        return a.distanceKm - b.distanceKm;
      }
      if (a.distanceKm == null && b.distanceKm != null) return 1;
      if (a.distanceKm != null && b.distanceKm == null) return -1;
      return (b.theyGive.length + b.iGive.length) - (a.theyGive.length + a.iGive.length);
    });

    res.json({ partners, hasLocation: meRow.lat != null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al buscar trueques.' });
  }
});

export default router;
