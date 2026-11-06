// Prints a single fresh code. Useful for debugging or for the pre-compute approach.
import { freshCode } from './totp.js';
const { code, remaining } = await freshCode();
console.log(process.env.TOTP_VERBOSE ? `${code} (${remaining}s left)` : code);
