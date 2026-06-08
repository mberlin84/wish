// Aplica el esquema de la base de datos. Uso: npm run migrate
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ Migración aplicada correctamente.');
  await pool.end();
}

run().catch((e) => {
  console.error('❌ Error en la migración:', e.message);
  process.exit(1);
});
