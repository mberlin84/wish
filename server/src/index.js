import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import albumRoutes from './routes/album.js';
import collectionRoutes from './routes/collection.js';
import tradeRoutes from './routes/trades.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/album', albumRoutes);
app.use('/api/collection', collectionRoutes);
app.use('/api/trades', tradeRoutes);

// Sirve la PWA (la raíz del proyecto está dos niveles arriba: server/src -> server -> raíz).
// dotfiles 'deny' bloquea (403) el acceso a .git y otros archivos ocultos.
const root = path.join(__dirname, '..', '..');
app.use(express.static(root, { dotfiles: 'deny' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`));
