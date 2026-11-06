import http from 'node:http';
import { freshCode, loadSecret } from './totp.js';

const PORT = Number(process.env.TOTP_PORT ?? 4567);
const TOKEN = process.env.TOTP_SERVER_TOKEN; // optional shared token

loadSecret(); // fail fast at startup if the secret is missing

const server = http.createServer(async (req, res) => {
  if (req.url !== '/otp' || req.method !== 'GET') {
    res.writeHead(404).end();
    return;
  }
  if (TOKEN && req.headers['x-otp-token'] !== TOKEN) {
    res.writeHead(401).end();
    return;
  }
  try {
    const { code, remaining } = await freshCode();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code, remaining }));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`TOTP server listening on http://127.0.0.1:${PORT}/otp`);
});
