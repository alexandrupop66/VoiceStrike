import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { initDatabase } from './db/database.js';
import { apiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '../../.env') });

const PORT = Number(process.env.PORT ?? 3001);

initDatabase();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

// Deployment adapter: when the production client bundle exists, serve it from the
// same origin as the API. Local Vite development remains unchanged.
const clientDist = path.resolve(__dirname, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.accepts('html')) {
      return res.sendFile(path.join(clientDist, 'index.html'));
    }
    return next();
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VoiceStrike Build 7 API running at http://localhost:${PORT}`);
  console.log(`AssemblyAI API key: ${process.env.ASSEMBLYAI_API_KEY ? 'configured' : 'NOT CONFIGURED'}`);
});
