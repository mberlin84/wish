-- Esquema de la base de datos (PostgreSQL).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  city          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tarjetas/láminas asociadas a cada usuario (cantidad por código).
CREATE TABLE IF NOT EXISTS stickers (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1 CHECK (count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);

CREATE INDEX IF NOT EXISTS idx_stickers_code ON stickers (code);

-- Mensajes de chat entre usuarios (para coordinar trueques).
CREATE TABLE IF NOT EXISTS messages (
  id           SERIAL PRIMARY KEY,
  sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages (recipient_id, read_at);

-- Definición global del álbum (secciones con prefijo + rango de números).
CREATE TABLE IF NOT EXISTS album_sections (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  prefix     TEXT NOT NULL DEFAULT '',
  from_n     INTEGER NOT NULL,
  to_n       INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Semilla del set Mundial 2026 (editable; el conteo oficial aún no está cerrado).
INSERT INTO album_sections (name, prefix, from_n, to_n, sort_order)
SELECT 'Base', '', 1, 700, 1
WHERE NOT EXISTS (SELECT 1 FROM album_sections);

INSERT INTO album_sections (name, prefix, from_n, to_n, sort_order)
SELECT 'Especiales', 'E', 1, 30, 2
WHERE NOT EXISTS (SELECT 1 FROM album_sections WHERE prefix = 'E');
