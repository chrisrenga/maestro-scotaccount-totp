// Exercises the shell wrapper with a fake `maestro` on PATH.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { authenticator } from 'otplib';
import { DEMO_SECRET } from './helpers/vectors.mjs';

const run = promisify(execFile);
const script = new URL('../scripts/run-maestro-with-otp.sh', import.meta.url).pathname;
const flow = new URL('../maestro/scotaccount-login.yaml', import.meta.url).pathname;

const good = {
  SCOTACCOUNT_TOTP_SECRET: DEMO_SECRET,
  SCOTACCOUNT_EMAIL: 'e2e@example.com',
  SCOTACCOUNT_PASSWORD: 'pw',
  TOTP_MIN_REMAINING: '0',
};

// Creates a fake maestro binary that records its args and, while the wrapper's
// server is still up, fetches a code from it and records the HTTP status.
function fakeMaestro(exitCode = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-maestro-'));
  const log = join(dir, 'maestro.log');
  const bin = join(dir, 'maestro');
  writeFileSync(bin, `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${log}"
url=""; token=""
while [ $# -gt 0 ]; do
  case "$1" in
    -e) case "$2" in TOTP_SERVER_URL=*) url="\${2#*=}";; TOTP_SERVER_TOKEN=*) token="\${2#*=}";; esac; shift 2;;
    *) shift;;
  esac
done
curl -s -o "${dir}/body" -w '%{http_code}' -H "X-OTP-Token: $token" "$url" > "${dir}/status"
curl -s -o /dev/null -w '%{http_code}' "$url" > "${dir}/status-notoken"
exit ${exitCode}
`);
  chmodSync(bin, 0o755);
  return { dir, log, bin };
}

function envWith(fake, overrides = {}) {
  return { ...process.env, ...good, PATH: `${fake.dir}:${process.env.PATH}`, TOTP_PORT: String(20000 + Math.floor(Math.random() * 20000)), ...overrides };
}

describe('run-maestro-with-otp.sh', () => {
  test('fails fast when a required variable is missing', async () => {
    for (const name of ['SCOTACCOUNT_TOTP_SECRET', 'SCOTACCOUNT_EMAIL', 'SCOTACCOUNT_PASSWORD']) {
      const fake = fakeMaestro();
      const env = envWith(fake);
      delete env[name];
      await assert.rejects(run('bash', [script, flow], { env }), (err) => {
        assert.notEqual(err.code, 0);
        assert.match(err.stderr, new RegExp(`${name} must be set`));
        assert.ok(!existsSync(fake.log), 'maestro must not have been invoked');
        return true;
      });
    }
  });

  test('fails when no flow file is given', async () => {
    const fake = fakeMaestro();
    await assert.rejects(run('bash', [script], { env: envWith(fake) }), /flow file required/);
  });

  test('starts the server, passes URL and token, and maestro can fetch a valid code', async () => {
    const fake = fakeMaestro();
    const env = envWith(fake);
    await run('bash', [script, flow, '--device', 'emu'], { env });

    const args = readFileSync(fake.log, 'utf8').trim().split('\n');
    assert.ok(args.includes('-e') && args.includes('SCOTACCOUNT_EMAIL=e2e@example.com'));
    assert.ok(args.includes('SCOTACCOUNT_PASSWORD=pw'));
    assert.ok(args.includes(`TOTP_SERVER_URL=http://127.0.0.1:${env.TOTP_PORT}/otp`));
    assert.ok(args.some((a) => /^TOTP_SERVER_TOKEN=[0-9a-f]{32}$/.test(a)), 'random 32 hex token');
    assert.deepEqual(args.slice(-3), ['--device', 'emu', flow], 'extra args before the flow');

    assert.equal(readFileSync(join(fake.dir, 'status'), 'utf8'), '200');
    assert.equal(readFileSync(join(fake.dir, 'status-notoken'), 'utf8'), '401');
    const { code } = JSON.parse(readFileSync(join(fake.dir, 'body'), 'utf8'));
    assert.ok(authenticator.check(code, DEMO_SECRET));
  });

  test('stops the server after maestro exits', async () => {
    const fake = fakeMaestro();
    const env = envWith(fake);
    await run('bash', [script, flow], { env });
    await assert.rejects(fetch(`http://127.0.0.1:${env.TOTP_PORT}/otp`));
  });

  test('propagates a failing maestro exit code and still stops the server', async () => {
    const fake = fakeMaestro(3);
    const env = envWith(fake);
    await assert.rejects(run('bash', [script, flow], { env }), (err) => err.code === 3);
    await assert.rejects(fetch(`http://127.0.0.1:${env.TOTP_PORT}/otp`));
  });

  test('honours a caller-supplied TOTP_SERVER_TOKEN', async () => {
    const fake = fakeMaestro();
    await run('bash', [script, flow], { env: envWith(fake, { TOTP_SERVER_TOKEN: 'fixed-token' }) });
    assert.ok(readFileSync(fake.log, 'utf8').includes('TOTP_SERVER_TOKEN=fixed-token'));
    assert.equal(readFileSync(join(fake.dir, 'status'), 'utf8'), '200');
  });
});
