import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from 'otplib';
import { runMaestroScript } from './helpers/runSandbox.mjs';
import { RFC_SECRET, RFC_VECTORS, DEMO_SECRET } from './helpers/vectors.mjs';

const run = (secret, nowMs, extra = {}) =>
  runMaestroScript('totpInline.js', { env: { TOTP_SECRET: secret, TOTP_MIN_REMAINING: '0', ...extra }, nowMs });

describe('totpInline.js', () => {
  test('matches the RFC 6238 test vectors', () => {
    for (const [t, expected] of RFC_VECTORS) {
      assert.equal(run(RFC_SECRET, t * 1000).output.otp, expected, `T=${t}`);
    }
  });

  test('matches otplib for the current time', () => {
    const { output } = run(DEMO_SECRET);
    assert.ok(authenticator.check(output.otp, DEMO_SECRET));
  });

  test('matches otplib for a secret longer than the SHA-1 block size', () => {
    const long = 'A'.repeat(120); // 75 bytes decoded, exercises the key-hashing branch
    const t = 1_700_000_000_000;
    assert.equal(run(long, t).output.otp, authenticator.clone({ epoch: t }).generate(long));
  });

  test('normalises spaces, dashes, lowercase and padding', () => {
    const t = 1_700_000_000_000;
    const expected = run(DEMO_SECRET, t).output.otp;
    assert.equal(run(' jbsw-y3dp ehpk 3pxp ', t).output.otp, expected);
    assert.equal(run('JBSWY3DPEHPK3PXP====', t).output.otp, expected);
  });

  test('preserves leading zeros', () => {
    assert.equal(run(RFC_SECRET, 1234567890 * 1000).output.otp, '005924');
  });

  test('uses the current window when enough time remains', () => {
    const { output, logs } = run(DEMO_SECRET, 60_000, { TOTP_MIN_REMAINING: '5' });
    assert.equal(output.otp, authenticator.clone({ epoch: 60_000 }).generate(DEMO_SECRET));
    assert.match(logs[0], /30s remaining/);
  });

  test('rolls to the next window when fewer than TOTP_MIN_REMAINING seconds are left', () => {
    const { output, logs } = run(DEMO_SECRET, 88_000, { TOTP_MIN_REMAINING: '5' }); // 2s left
    assert.equal(output.otp, authenticator.clone({ epoch: 90_000 }).generate(DEMO_SECRET));
    assert.match(logs[0], /30s remaining/);
  });

  test('defaults TOTP_MIN_REMAINING to 5', () => {
    const { output } = run(DEMO_SECRET, 86_000, { TOTP_MIN_REMAINING: undefined }); // 4s left
    assert.equal(output.otp, authenticator.clone({ epoch: 90_000 }).generate(DEMO_SECRET));
  });

  test('never logs the code or the secret', () => {
    const { output, logs } = run(DEMO_SECRET);
    assert.ok(!logs.join('\n').includes(output.otp));
    assert.ok(!logs.join('\n').includes(DEMO_SECRET));
  });

  test('throws when TOTP_SECRET is missing or empty', () => {
    assert.throws(() => run(undefined), /TOTP_SECRET is not set/);
    assert.throws(() => run(''), /TOTP_SECRET is not set/);
  });

  test('throws on characters outside base32', () => {
    assert.throws(() => run('JBSWY3DP1'), /Invalid base32 character: 1/);
    assert.throws(() => run('JBSW!'), /Invalid base32 character/);
  });

  test('does not rely on ES6 features that Rhino lacks', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../maestro/totpInline.js', import.meta.url), 'utf8');
    for (const token of ['const ', 'let ', '=>', '`', 'class ', 'import ', 'require(']) {
      assert.ok(!src.includes(token), `found ${JSON.stringify(token)}`);
    }
  });
});
