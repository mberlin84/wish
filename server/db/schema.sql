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

-- Semilla del set oficial Panini Mundial 2026: 48 selecciones × 20 (escudo +
-- foto de equipo + 18 jugadores), numeradas por equipo (KOR 1…KOR 20), más 20
-- láminas especiales (Introducción + FIFA Museum). Total 980.
--
-- Upgrade idempotente: si el álbum sigue siendo el set viejo (una sola sección
-- plana 1-980), se reemplaza. Los álbumes personalizados (cualquier otra cosa)
-- NO se tocan, y si ya está el set por países tampoco se reinserta.
DELETE FROM album_sections
WHERE prefix = '' AND from_n = 1 AND to_n = 980
  AND (SELECT count(*) FROM album_sections) = 1;

INSERT INTO album_sections (name, prefix, from_n, to_n, sort_order)
SELECT * FROM (VALUES
  ('Argelia','ALG',1,20,1),
  ('Argentina','ARG',1,20,2),
  ('Australia','AUS',1,20,3),
  ('Austria','AUT',1,20,4),
  ('Bélgica','BEL',1,20,5),
  ('Bosnia y Herzegovina','BIH',1,20,6),
  ('Brasil','BRA',1,20,7),
  ('Canadá','CAN',1,20,8),
  ('Cabo Verde','CPV',1,20,9),
  ('Colombia','COL',1,20,10),
  ('RD del Congo','COD',1,20,11),
  ('Croacia','CRO',1,20,12),
  ('Curazao','CUW',1,20,13),
  ('Chequia','CZE',1,20,14),
  ('Ecuador','ECU',1,20,15),
  ('Egipto','EGY',1,20,16),
  ('Inglaterra','ENG',1,20,17),
  ('Francia','FRA',1,20,18),
  ('Alemania','GER',1,20,19),
  ('Ghana','GHA',1,20,20),
  ('Haití','HAI',1,20,21),
  ('Irán','IRN',1,20,22),
  ('Irak','IRQ',1,20,23),
  ('Costa de Marfil','CIV',1,20,24),
  ('Japón','JPN',1,20,25),
  ('Jordania','JOR',1,20,26),
  ('México','MEX',1,20,27),
  ('Marruecos','MAR',1,20,28),
  ('Países Bajos','NED',1,20,29),
  ('Nueva Zelanda','NZL',1,20,30),
  ('Noruega','NOR',1,20,31),
  ('Panamá','PAN',1,20,32),
  ('Paraguay','PAR',1,20,33),
  ('Portugal','POR',1,20,34),
  ('Catar','QAT',1,20,35),
  ('Arabia Saudita','KSA',1,20,36),
  ('Escocia','SCO',1,20,37),
  ('Senegal','SEN',1,20,38),
  ('Sudáfrica','RSA',1,20,39),
  ('Corea del Sur','KOR',1,20,40),
  ('España','ESP',1,20,41),
  ('Suecia','SWE',1,20,42),
  ('Suiza','SUI',1,20,43),
  ('Túnez','TUN',1,20,44),
  ('Turquía','TUR',1,20,45),
  ('Uruguay','URU',1,20,46),
  ('Estados Unidos','USA',1,20,47),
  ('Uzbekistán','UZB',1,20,48),
  ('Especiales (Intro + FIFA Museum)','FWC',1,20,49)
) AS v(name, prefix, from_n, to_n, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM album_sections);

-- Login por enlace mágico (magic link): tokens de un solo uso con vencimiento.
CREATE TABLE IF NOT EXISTS login_tokens (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens (email);

-- Ya no se usa contraseña (login por magic link): password_hash deja de ser obligatorio.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
