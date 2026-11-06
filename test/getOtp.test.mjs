import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runMaestroScript } from './helpers/runSandbox.mjs';

function fakeHttp(response) {
  const calls = [];
  return {
    calls,
    get: (url, config) => { calls.push({ url, config }); return response; },
  };
}

describe('getOtp.js', () => {
  test('stores the code from a successful response', () => {
    const http = fakeHttp({ ok: true, status: 200, body: '{"code":"123456","remaining":17}' });
    const { output, logs } = runMaestroScript('getOtp.js', { http, env: { TOTP_SERVER_URL: 'http://127.0.0.1:9/otp', TOTP_SERVER_TOKEN: 'tok' } });
    assert.equal(output.otp, '123456');
    assert.equal(http.calls[0].url, 'http://127.0.0.1:9/otp');
    assert.deepEqual(http.calls[0].config.headers, { 'X-OTP-Token': 'tok' });
    assert.match(logs[0], /17s remaining/);
    assert.ok(!logs[0].includes('123456'));
  });

  test('falls back to the default URL and sends no token header when unset', () => {
    const http = fakeHttp({ ok: true, status: 200, body: '{"code":"000001","remaining":30}' });
    runMaestroScript('getOtp.js', { http, env: {} });
    assert.equal(http.calls[0].url, 'http://127.0.0.1:4567/otp');
    assert.deepEqual(http.calls[0].config.headers, {});
  });

  test('throws on a non-2xx response including the status', () => {
    const http = fakeHttp({ ok: false, status: 401, body: '' });
    assert.throws(() => runMaestroScript('getOtp.js', { http, env: {} }), /TOTP server returned 401/);
  });

  test('throws when the body has no code', () => {
    const http = fakeHttp({ ok: true, status: 200, body: '{"error":"boom"}' });
    assert.throws(() => runMaestroScript('getOtp.js', { http, env: {} }), /invalid code/);
  });

  test('throws when the code is not six digits', () => {
    for (const body of ['{"code":"12345"}', '{"code":"1234567"}', '{"code":"12a456"}', '{"code":123456}']) {
      const http = fakeHttp({ ok: true, status: 200, body });
      assert.throws(() => runMaestroScript('getOtp.js', { http, env: {} }), /invalid code/, body);
    }
  });

  test('throws when the body is not JSON', () => {
    const http = fakeHttp({ ok: true, status: 200, body: '<html>' });
    assert.throws(() => runMaestroScript('getOtp.js', { http, env: {} }));
  });
});
