import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authenticator } from 'otplib';
import { DEMO_SECRET } from './helpers/vectors.mjs';

const run = promisify(execFile);
const script = new URL('../otp-print.js', import.meta.url).pathname;

describe('otp-print', () => {
  test('prints a six digit code', async () => {
    const { stdout } = await run('node', [script], {
      env: { ...process.env, SCOTACCOUNT_TOTP_SECRET: DEMO_SECRET, TOTP_MIN_REMAINING: '0', TOTP_VERBOSE: '' },
    });
    const code = stdout.trim();
    assert.match(code, /^\d{6}$/);
    assert.ok(authenticator.check(code, DEMO_SECRET));
  });

  test('prints remaining seconds in verbose mode', async () => {
    const { stdout } = await run('node', [script], {
      env: { ...process.env, SCOTACCOUNT_TOTP_SECRET: DEMO_SECRET, TOTP_MIN_REMAINING: '0', TOTP_VERBOSE: '1' },
    });
    assert.match(stdout.trim(), /^\d{6} \(\d{1,2}s left\)$/);
  });

  test('exits 1 with a message when the secret is missing', async () => {
    const env = { ...process.env };
    delete env.SCOTACCOUNT_TOTP_SECRET;
    await assert.rejects(run('node', [script], { env }), (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr, /SCOTACCOUNT_TOTP_SECRET is not set/);
      return true;
    });
  });
});
