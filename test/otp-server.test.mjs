import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from 'otplib';
import { createOtpServer } from '../otp-server.js';
import { DEMO_SECRET } from './helpers/vectors.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve(`http://127.0.0.1:${server.address().port}`);
  }));
}

describe('otp-server with a token', () => {
  let server, base;
  before(async () => { server = createOtpServer({ token: 'shh', secret: DEMO_SECRET }); base = await listen(server); });
  after(() => server.close());

  test('returns a valid code and remaining seconds', async () => {
    const res = await fetch(`${base}/otp`, { headers: { 'x-otp-token': 'shh' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    const body = await res.json();
    assert.match(body.code, /^\d{6}$/);
    assert.ok(authenticator.check(body.code, DEMO_SECRET));
    assert.ok(body.remaining >= 1 && body.remaining <= 30);
  });

  test('rejects a missing token', async () => {
    const res = await fetch(`${base}/otp`);
    assert.equal(res.status, 401);
  });

  test('rejects a wrong token', async () => {
    const res = await fetch(`${base}/otp`, { headers: { 'x-otp-token': 'nope' } });
    assert.equal(res.status, 401);
  });

  test('404s unknown paths and non-GET methods', async () => {
    assert.equal((await fetch(`${base}/`, { headers: { 'x-otp-token': 'shh' } })).status, 404);
    assert.equal((await fetch(`${base}/otp/`, { headers: { 'x-otp-token': 'shh' } })).status, 404);
    assert.equal((await fetch(`${base}/otp`, { method: 'POST', headers: { 'x-otp-token': 'shh' } })).status, 404);
  });

  test('never includes the secret in the response', async () => {
    const text = await (await fetch(`${base}/otp`, { headers: { 'x-otp-token': 'shh' } })).text();
    assert.ok(!text.includes(DEMO_SECRET));
  });
});

describe('otp-server without a token', () => {
  let server, base;
  before(async () => { server = createOtpServer({ secret: DEMO_SECRET }); base = await listen(server); });
  after(() => server.close());

  test('serves codes to anyone on localhost', async () => {
    const res = await fetch(`${base}/otp`);
    assert.equal(res.status, 200);
  });
});

describe('otp-server startup', () => {
  test('throws when the secret is missing', () => {
    const saved = process.env.SCOTACCOUNT_TOTP_SECRET;
    delete process.env.SCOTACCOUNT_TOTP_SECRET;
    try {
      assert.throws(() => createOtpServer({}), /SCOTACCOUNT_TOTP_SECRET is not set/);
    } finally {
      if (saved !== undefined) process.env.SCOTACCOUNT_TOTP_SECRET = saved;
    }
  });

  test('throws when the secret is not base32', () => {
    assert.throws(() => createOtpServer({ secret: 'INVALID!' }), /not valid base32/);
  });

  test('returns 500 with an error body when code generation fails at request time', async () => {
    const server = createOtpServer({ secret: DEMO_SECRET });
    const base = await listen(server);
    const saved = process.env.TOTP_MIN_REMAINING;
    process.env.TOTP_MIN_REMAINING = 'garbage';
    try {
      const res = await fetch(`${base}/otp`);
      assert.equal(res.status, 500);
      assert.match((await res.json()).error, /between 0 and 29/);
    } finally {
      if (saved === undefined) delete process.env.TOTP_MIN_REMAINING; else process.env.TOTP_MIN_REMAINING = saved;
      server.close();
    }
  });
});
