import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';

const port = Number(process.env.PORT || process.env.HEARTBEAT_PORT || 3392);
const host = process.env.HOST || process.env.HEARTBEAT_HOST || '127.0.0.1';
const activeWindowMs = Number(process.env.HEARTBEAT_ACTIVE_WINDOW_MS || 60_000);
const stateUrl = new URL('./.heartbeat-state.json', import.meta.url);
const allowedOrigins = new Set(
  (process.env.HEARTBEAT_ALLOWED_ORIGINS || 'https://frontier-pm.repo.box,http://localhost:5173,http://localhost:5106')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

let lastSeen = 0;
try {
  const state = JSON.parse(readFileSync(stateUrl, 'utf8'));
  if (Number.isFinite(state.lastSeen)) lastSeen = Number(state.lastSeen);
} catch {}

function writeState() {
  writeFileSync(stateUrl, `${JSON.stringify({ lastSeen, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

function statusBody() {
  const ageMs = lastSeen ? Date.now() - lastSeen : null;
  return {
    active: ageMs !== null && ageMs >= 0 && ageMs < activeWindowMs,
    lastSeen: lastSeen ? new Date(lastSeen).toISOString() : null,
    lastSeenSecsAgo: ageMs === null ? null : Math.max(0, Math.floor(ageMs / 1000)),
    activeWindowSecs: Math.floor(activeWindowMs / 1000),
  };
}

function sendJson(req, res, code, body) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(`${JSON.stringify(body)}\n`);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    sendJson(req, res, 200, statusBody());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/heartbeat') {
    lastSeen = Date.now();
    writeState();
    sendJson(req, res, 200, statusBody());
    return;
  }

  sendJson(req, res, 404, { error: 'not found' });
});

server.listen(port, host, () => {
  console.log(new Date().toISOString(), `[heartbeat] listening on ${host}:${port}`);
});
