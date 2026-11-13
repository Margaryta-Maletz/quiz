import express from 'express';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { GameSession } from './session.js';
import { loadQuestions } from './questions.js';
import { handleMessage } from './handlers.js';
import type { ConnectionInfo } from './handlers.js';

const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const session = new GameSession();
const questions = loadQuestions();
const connections = new Map<WebSocket, ConnectionInfo>();

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/questions/index.json', (_req, res) => {
  res.json([...questions.keys()]);
});

app.get('/questions/:filename', (req, res) => {
  const file = questions.get(req.params.filename);
  if (!file) {
    res.status(404).json({ error: 'question file not found' });
    return;
  }
  res.json([...file.values()]);
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const roleParam = url.searchParams.get('role');
  const role: ConnectionInfo['role'] = roleParam === 'present' ? 'present' : null;

  connections.set(ws, { role });
  console.log(`[ws] connected   role=${role ?? 'unknown'}  clients=${wss.clients.size}`);

  ws.on('message', (raw) => handleMessage(ws, raw, { session, connections, questions }));

  ws.on('close', () => {
    connections.delete(ws);
    console.log(`[ws] disconnected clients=${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`[ws] error`, err.message);
  });
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
