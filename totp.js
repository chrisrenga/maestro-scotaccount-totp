import { authenticator } from 'otplib';

// Tolerate one step either side, matching what most IdPs accept.
authenticator.options = { window: 1 };

const MIN_REMAINING_SECONDS = Number(process.env.TOTP_MIN_REMAINING ?? 5);

export function loadSecret() {
  const raw = process.env.SCOTACCOUNT_TOTP_SECRET;
  if (!raw) {
    throw new Error('SCOTACCOUNT_TOTP_SECRET is not set');
  }
  // Manual-entry keys are often shown with spaces and lowercase. Normalise.
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function secondsRemaining() {
  return authenticator.timeRemaining();
}

// Returns a code with at least MIN_REMAINING_SECONDS left in its window,
// waiting for the next window if the current one is nearly over.
export async function freshCode(secret = loadSecret()) {
  const remaining = secondsRemaining();
  if (remaining < MIN_REMAINING_SECONDS) {
    await new Promise((r) => setTimeout(r, (remaining + 0.5) * 1000));
  }
  return {
    code: authenticator.generate(secret),
    remaining: secondsRemaining(),
  };
}
