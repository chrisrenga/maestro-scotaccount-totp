# ScotAccount TOTP helper for Maestro E2E

Maestro's JavaScript runs in a GraalJS sandbox with no Node libraries, so it cannot
compute a TOTP code itself. This package runs a tiny local HTTP server that generates
codes from the test account's secret. The Maestro flow fetches a fresh code with
`http.get` right before typing it.

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
| `maestro/getOtp.js` | Script run inside Maestro that fetches the code into `output.otp` |
| `maestro/scotaccount-login.yaml` | Example login flow |
| `scripts/run-maestro-with-otp.sh` | Starts the server, runs the flow, stops the server |

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

## Run locally

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

## Consuming from an existing Maestro flow

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

## Alternative: pre-compute without a server

If running a background process is awkward, generate one code and pass it in:

```bash
maestro test -e OTP_CODE="$(node otp-print.js)" flow.yaml
```

Then use `inputText: ${OTP_CODE}`. This only works if the flow reaches the security
code screen within the remaining window (at most 30 seconds from app launch), so it is
flaky on slow CI simulators. Prefer the server.

## Jest / React Native Testing Library

None of this applies to unit tests. Mock the OIDC client and the deep link callback
there. The OTP is purely an E2E concern.

## Gotchas

- **Concurrency.** Two test runs sharing one account at the same time will work for TOTP
  (the code is time based, not single use) but ScotAccount may reject a replayed code
  within the same window. Serialise ScotAccount E2E jobs or use one account per shard.
- **iOS in-app browser.** If the app opens ScotAccount in `ASWebAuthenticationSession`,
  Maestro usually cannot see its content. Android Chrome Custom Tabs are generally fine.
  Consider a plain WebView in the E2E build, or test the OIDC callback deep link directly.
- **Rotate the secret** if it ever appears in logs. The server never logs the code, and
  `getOtp.js` only logs the seconds remaining.
