# ScotAccount TOTP helper for Maestro E2E

ScotAccount supports an authenticator app (TOTP) as its second factor. For E2E
tests, capture the test account's TOTP secret once and generate codes in the test.

Maestro's JavaScript runs in a GraalJS sandbox with no Node libraries, so `otplib`
cannot run inside a flow. This repo gives two ways round that:

| Option | How | When to use |
|--------|-----|-------------|
| **A. Inline (recommended)** | `maestro/totpInline.js` computes the code in pure JavaScript inside the Maestro sandbox. No server, no app changes. | Default. One file dropped next to your flow. |
| **B. Local server** | `otp-server.js` generates codes with `otplib`; the flow fetches them with `http.get`. | If you want one shared code source for several tools (Maestro, Playwright, manual testing). |

Both are verified against the RFC 6238 test vectors. `npm test` runs the full suite, see [Tests](#tests).

## Option A: inline, no server

Copy `maestro/totpInline.js` next to your flow and add, on the security code screen:

```yaml
- extendedWaitUntil:
    visible: "Security code"
    timeout: 20000
- runScript:
    file: totpInline.js
    env:
      TOTP_SECRET: ${MAESTRO_TOTP_SECRET}
- tapOn: "Security code"
- inputText: ${output.otp}
```

Run it:

```bash
export MAESTRO_TOTP_SECRET='JBSW Y3DP EHPK 3PXP'   # Maestro CLI exposes MAESTRO_* vars to flows
maestro test -e SCOTACCOUNT_EMAIL=… -e SCOTACCOUNT_PASSWORD=… maestro/scotaccount-login-noserver.yaml
```

The script is ES5 so it also works if Rhino is enabled. If fewer than 5 seconds remain
in the current 30 second window it generates the code for the next window instead
(`TOTP_MIN_REMAINING` to change). It never logs the code or the secret.

See `maestro/scotaccount-login-noserver.yaml` for the full flow.

## Option B: local server

```
┌──────────────┐  http.get /otp   ┌──────────────────┐
│ Maestro flow │ ───────────────▶ │ otp-server.js    │ ── otplib ──▶ 6 digit code
│ (getOtp.js)  │ ◀─────────────── │ 127.0.0.1:4567   │
└──────────────┘  {"code":"…"}    └──────────────────┘
                                   reads SCOTACCOUNT_TOTP_SECRET
```

## Files

| File | Purpose |
|------|---------|
| `totp.js` | Loads and normalises the secret, generates a code, waits if the 30s window is nearly over |
| `otp-server.js` | Local HTTP server exposing `GET /otp` |
| `otp-print.js` | Prints one code to stdout (debugging, or the pre-compute approach) |
| `maestro/totpInline.js` | Option A: pure-JS TOTP run inside Maestro, writes `output.otp` |
| `maestro/scotaccount-login-noserver.yaml` | Option A example flow |
| `maestro/getOtp.js` | Option B: fetches the code from the server into `output.otp` |
| `maestro/scotaccount-login.yaml` | Option B example flow |
| `scripts/run-maestro-with-otp.sh` | Option B: starts the server, runs the flow, stops the server |
| `test/totpInline.test.mjs` | Checks the inline script against RFC 6238 vectors and otplib |

## One-time setup: get the secret

1. Create a dedicated test account on the ScotAccount **integration** environment. Never use a real person's account.
2. During 2FA enrolment choose the authenticator app option.
3. Instead of scanning the QR code, pick the "enter the key manually" option and copy the key. It is a base32 string, sometimes shown in groups with spaces. Spaces and case do not matter, the helper normalises them.
4. Also add the same key to a real authenticator app on a phone so a human can sign in to the account if needed.
5. Store the key as a masked CI secret named `SCOTACCOUNT_TOTP_SECRET`. Do not commit it.

## Install

```bash
cd scotaccount-totp-helper
npm install
cp .env.example .env   # local use only, fill in real values
```

## Option B: run locally

```bash
export SCOTACCOUNT_TOTP_SECRET='JBSW Y3DP EHPK 3PXP'
export SCOTACCOUNT_EMAIL='e2e-test@example.com'
export SCOTACCOUNT_PASSWORD='…'

npm run e2e:scotaccount
# or, with extra maestro args:
scripts/run-maestro-with-otp.sh maestro/scotaccount-login.yaml --device emulator-5554
```

The wrapper script:

- fails fast if any secret is missing
- generates a random per-run `TOTP_SERVER_TOKEN` so nothing else on the machine can read codes
- starts `otp-server.js`, waits until it responds, runs `maestro test`, then kills the server

Sanity check the code against the authenticator app on the phone:

```bash
npm run otp:print
```

## Option B: consuming from an existing Maestro flow

Copy `maestro/getOtp.js` next to your flow and add these steps where the security code screen appears:

```yaml
- extendedWaitUntil:
    visible: "Security code"
    timeout: 20000
- runScript:
    file: getOtp.js
    env:
      TOTP_SERVER_URL: ${TOTP_SERVER_URL}
      TOTP_SERVER_TOKEN: ${TOTP_SERVER_TOKEN}
- tapOn: "Security code"
- inputText: ${output.otp}
```

Fetch the code as late as possible. The server already refuses to hand out a code
with fewer than 5 seconds left in its window (configurable with `TOTP_MIN_REMAINING`),
but the flow still has to type and submit it before the window closes.

Pass the two variables with `-e` when running Maestro yourself:

```bash
maestro test -e TOTP_SERVER_URL=http://127.0.0.1:4567/otp -e TOTP_SERVER_TOKEN=… flow.yaml
```

`http.get` in Maestro runs on the host machine, not on the device, so `127.0.0.1`
is correct even for Android emulators and physical devices.

## CI (GitHub Actions example)

```yaml
- name: Install helper
  run: npm ci --prefix e2e/scotaccount-totp-helper

- name: Run ScotAccount E2E
  env:
    SCOTACCOUNT_TOTP_SECRET: ${{ secrets.SCOTACCOUNT_TOTP_SECRET }}
    SCOTACCOUNT_EMAIL: ${{ secrets.SCOTACCOUNT_EMAIL }}
    SCOTACCOUNT_PASSWORD: ${{ secrets.SCOTACCOUNT_PASSWORD }}
  run: e2e/scotaccount-totp-helper/scripts/run-maestro-with-otp.sh e2e/flows/scotaccount-login.yaml
```

Make sure the runner's clock is NTP synced. Clock drift is the most common reason a
correct secret produces rejected codes.

## Alternative: pre-compute with otp-print.js

If running a background process is awkward, generate one code and pass it in:

```bash
maestro test -e OTP_CODE="$(node otp-print.js)" flow.yaml
```

Then use `inputText: ${OTP_CODE}`. This only works if the flow reaches the security
code screen within the remaining window (at most 30 seconds from app launch), so it is
flaky on slow CI simulators. Prefer the server.

## What about generating the code inside the React Native app?

It is possible but not worth it. You would add an E2E-only screen that computes the
code from a secret passed via launch arguments, render it in a `Text` with a testID,
and use Maestro's `copyTextFrom` / `pasteText` to move it into the ScotAccount page.
The problems:

- ScotAccount opens in a browser (Custom Tab or in-app browser), so the app is
  backgrounded exactly when you need the code. Switching back and forth is slow and
  the 30 second window often expires.
- Passing the secret needs a native module for launch arguments, or baking it into
  the build. Test-only code ends up in the app bundle.
- It gives you nothing over Option A, which already runs without a server.

## Jest / React Native Testing Library

None of this applies to unit tests. Mock the OIDC client and the deep link callback
there. The OTP is purely an E2E concern.

## Tests

```bash
npm test
```

Uses `node:test`, no extra dependencies. Coverage:

| Area | Positive | Negative |
|------|----------|----------|
| `totp.js` | RFC 6238 vectors, agrees with otplib, six digits with leading zeros, waits for the next window when fewer than `TOTP_MIN_REMAINING` seconds remain, normalises spaced/dashed/lowercase keys | missing or blank secret, non base32 secret, invalid `TOTP_MIN_REMAINING` |
| `otp-server.js` | 200 with a valid code and remaining seconds, works with and without a token, secret never in response | missing token, wrong token, unknown path, non-GET, invalid secret at startup, 500 with error body when generation fails |
| `otp-print.js` | prints six digits, verbose format | exits 1 with message when secret missing |
| `maestro/totpInline.js` | run in a fake Maestro sandbox: RFC vectors, agrees with otplib, long secrets, normalisation, leading zeros, window roll-over, default min remaining, nothing sensitive logged, ES5 only | missing or empty `TOTP_SECRET`, invalid base32 characters |
| `maestro/getOtp.js` | stores code, sends token header, default URL | non-2xx, missing code, wrong length, non-digit, numeric instead of string, non-JSON body |
| `scripts/run-maestro-with-otp.sh` | with a fake `maestro` on `PATH`: server up, URL and token passed, extra args forwarded, code fetched is valid, server stopped afterwards, caller token honoured | each required variable missing, no flow file, failing maestro exit code propagated |

The negative tests found two real bugs while being written: `getOtp.js` accepted a
numeric `code` and `otplib` silently generates codes from a non base32 secret. Both
are fixed and covered.

## Gotchas

- **Concurrency.** Two test runs sharing one account at the same time will work for TOTP
  (the code is time based, not single use) but ScotAccount may reject a replayed code
  within the same window. Serialise ScotAccount E2E jobs or use one account per shard.
- **iOS in-app browser.** If the app opens ScotAccount in `ASWebAuthenticationSession`,
  Maestro usually cannot see its content. Android Chrome Custom Tabs are generally fine.
  Consider a plain WebView in the E2E build, or test the OIDC callback deep link directly.
- **Rotate the secret** if it ever appears in logs. The server never logs the code, and
  `getOtp.js` only logs the seconds remaining.
