import { authenticator } from 'otplib';

// Tolerate one step either side, matching what most IdPs accept.
authenticator.options = { window: 1 };

export const STEP_SECONDS = 30;

export function loadSecret(env = process.env) {
  const raw = env.SCOTACCOUNT_TOTP_SECRET;
  if (!raw || !raw.trim()) {
    throw new Error('SCOTACCOUNT_TOTP_SECRET is not set');
  }
  return normaliseSecret(raw);
}

// Manual-entry keys are often shown with spaces, dashes and lowercase.
export function normaliseSecret(raw) {
  const clean = String(raw).replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z2-7]+=*$/.test(clean)) {
    throw new Error('TOTP secret is not valid base32');
  }
  return clean;
}

export function secondsRemaining(nowMs = Date.now()) {
  return STEP_SECONDS - (Math.floor(nowMs / 1000) % STEP_SECONDS);
}

export function minRemaining(env = process.env) {
  const n = Number(env.TOTP_MIN_REMAINING ?? 5);
  if (!Number.isFinite(n) || n < 0 || n >= STEP_SECONDS) {
    throw new Error('TOTP_MIN_REMAINING must be a number between 0 and 29');
  }
  return n;
}

// Returns a code with at least minRemaining seconds left in its window,
// waiting for the next window if the current one is nearly over.
export async function freshCode(
  secret = loadSecret(),
  { now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), env = process.env } = {},
) {
  const clean = normaliseSecret(secret);
  const min = minRemaining(env);
  const remaining = secondsRemaining(now());
  if (remaining < min) {
    await sleep((remaining + 0.5) * 1000);
  }
  const t = now();
  return {
    code: authenticator.clone({ epoch: t }).generate(clean),
    remaining: secondsRemaining(t),
  };
}
