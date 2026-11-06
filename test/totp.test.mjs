import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from 'otplib';
import { loadSecret, normaliseSecret, secondsRemaining, minRemaining, freshCode } from '../totp.js';
import { RFC_SECRET, RFC_VECTORS, DEMO_SECRET } from './helpers/vectors.mjs';

describe('normaliseSecret', () => {
  test('strips spaces, dashes and uppercases', () => {
    assert.equal(normaliseSecret(' jbsw y3dp-ehpk 3pxp '), DEMO_SECRET);
  });
  test('keeps trailing padding', () => {
    assert.equal(normaliseSecret('jbswy3dp===='), 'JBSWY3DP====');
  });
  test('rejects characters outside base32', () => {
    assert.throws(() => normaliseSecret('JBSWY3DP1'), /not valid base32/);
    assert.throws(() => normaliseSecret('abc!'), /not valid base32/);
  });
});

describe('loadSecret', () => {
  test('throws when unset or blank', () => {
    assert.throws(() => loadSecret({}), /SCOTACCOUNT_TOTP_SECRET is not set/);
    assert.throws(() => loadSecret({ SCOTACCOUNT_TOTP_SECRET: '   ' }), /is not set/);
  });
  test('returns the normalised secret', () => {
    assert.equal(loadSecret({ SCOTACCOUNT_TOTP_SECRET: 'jbsw y3dp ehpk 3pxp' }), DEMO_SECRET);
  });
});

describe('secondsRemaining', () => {
  test('is 30 at the start of a window and 1 at the end', () => {
    assert.equal(secondsRemaining(60_000), 30);
    assert.equal(secondsRemaining(89_999), 1);
  });
  test('ignores sub-second time', () => {
    assert.equal(secondsRemaining(60_999), 30);
  });
});

describe('minRemaining', () => {
  test('defaults to 5', () => assert.equal(minRemaining({}), 5));
  test('reads TOTP_MIN_REMAINING', () => assert.equal(minRemaining({ TOTP_MIN_REMAINING: '10' }), 10));
  test('rejects garbage, negatives and values of 30 or more', () => {
    for (const v of ['abc', '-1', '30', '99']) {
      assert.throws(() => minRemaining({ TOTP_MIN_REMAINING: v }), /between 0 and 29/);
    }
  });
});

describe('freshCode', () => {
  const noWait = { TOTP_MIN_REMAINING: '0' };

  test('matches the RFC 6238 test vectors', async () => {
    for (const [t, expected] of RFC_VECTORS) {
      const { code } = await freshCode(RFC_SECRET, { now: () => t * 1000, env: noWait });
      assert.equal(code, expected, `T=${t}`);
    }
  });

  test('matches otplib for the current time', async () => {
    const { code } = await freshCode(DEMO_SECRET, { env: noWait });
    assert.ok(authenticator.check(code, DEMO_SECRET));
  });

  test('always returns six digits', async () => {
    const { code } = await freshCode(RFC_SECRET, { now: () => 1234567890 * 1000, env: noWait });
    assert.match(code, /^\d{6}$/);
    assert.equal(code, '005924'); // leading zero preserved
  });

  test('does not wait when enough time remains', async () => {
    let slept = 0;
    const res = await freshCode(DEMO_SECRET, {
      now: () => 60_000, sleep: (ms) => { slept += ms; }, env: { TOTP_MIN_REMAINING: '5' },
    });
    assert.equal(slept, 0);
    assert.equal(res.remaining, 30);
  });

  test('waits for the next window when the current one is nearly over', async () => {
    let clock = 88_000; // 2s left
    let slept = 0;
    const res = await freshCode(DEMO_SECRET, {
      now: () => clock,
      sleep: async (ms) => { slept += ms; clock += ms; },
      env: { TOTP_MIN_REMAINING: '5' },
    });
    assert.equal(slept, 2500);
    assert.equal(res.remaining, 30);
    assert.equal(res.code, authenticator.clone({ epoch: 90_500 }).generate(DEMO_SECRET));
  });

  test('rejects an invalid secret', async () => {
    await assert.rejects(freshCode('not base32!', { env: noWait }), /not valid base32/);
  });

  test('propagates an invalid TOTP_MIN_REMAINING', async () => {
    await assert.rejects(freshCode(DEMO_SECRET, { env: { TOTP_MIN_REMAINING: 'x' } }), /between 0 and 29/);
  });
});
