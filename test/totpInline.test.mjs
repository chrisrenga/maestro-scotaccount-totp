// Runs maestro/totpInline.js in Node with fake Maestro globals and checks it
// against the RFC 6238 SHA-1 test vectors and against otplib.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { authenticator } from 'otplib';

const src = readFileSync(new URL('../maestro/totpInline.js', import.meta.url), 'utf8');

function run(secret, nowMs) {
  const g = globalThis;
  g.TOTP_SECRET = secret;
  g.TOTP_MIN_REMAINING = '0';
  g.output = {};
  const RealDate = g.Date;
  if (nowMs != null) g.Date = { now: () => nowMs };
  try {
    new Function('console', src)({ log: () => {} });
  } finally {
    g.Date = RealDate;
  }
  return g.output.otp;
}

const vectors = [
  [59, '287082'], [1111111109, '081804'], [1111111111, '050471'],
  [1234567890, '005924'], [2000000000, '279037'],
];
for (const [t, expected] of vectors) {
  assert.equal(run('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', t * 1000), expected, `T=${t}`);
}

const secret = 'JBSWY3DPEHPK3PXP';
assert.equal(run('jbsw y3dp ehpk 3pxp'), authenticator.generate(secret));
console.log('totpInline.js OK');
