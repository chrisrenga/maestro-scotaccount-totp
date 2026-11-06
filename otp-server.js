import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { freshCode, loadSecret, normaliseSecret } from './totp.js';

export function createOtpServer({ token, secret } = {}) {
  const resolvedSecret = secret == null ? loadSecret() : normaliseSecret(secret); // fail fast

  return http.createServer(async (req, res) => {
    if (req.url !== '/otp' || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    if (token && req.headers['x-otp-token'] !== token) {
      res.writeHead(401).end();
      return;
    }
    try {
      const { code, remaining } = await freshCode(resolvedSecret);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code, remaining }));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = Number(process.env.TOTP_PORT ?? 4567);
  const server = createOtpServer({ token: process.env.TOTP_SERVER_TOKEN });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`TOTP server listening on http://127.0.0.1:${PORT}/otp`);
  });
}
