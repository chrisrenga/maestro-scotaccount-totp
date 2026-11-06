// Runs a maestro/*.js script the way Maestro would: bare globals for env
// values, plus the http / json / output / console objects.
import { readFileSync } from 'node:fs';

export function runMaestroScript(file, { env = {}, http, nowMs } = {}) {
  const src = readFileSync(new URL(`../../maestro/${file}`, import.meta.url), 'utf8');
  const logs = [];
  const output = {};
  const globals = {
    output,
    console: { log: (m) => logs.push(String(m)) },
    http,
    json: (s) => JSON.parse(s),
    Date: nowMs == null ? Date : { now: () => nowMs },
    ...env,
  };
  const names = Object.keys(globals);
  const fn = new Function(...names, src);
  fn(...names.map((n) => globals[n]));
  return { output, logs };
}
