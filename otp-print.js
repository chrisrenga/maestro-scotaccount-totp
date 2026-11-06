// Prints a single fresh code. Useful for debugging or for the pre-compute approach.
import { freshCode } from './totp.js';

try {
  const { code, remaining } = await freshCode();
  console.log(process.env.TOTP_VERBOSE ? `${code} (${remaining}s left)` : code);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
