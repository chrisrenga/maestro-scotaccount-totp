// Runs inside Maestro's GraalJS sandbox. No Node APIs here, only http/json/output.
// TOTP_SERVER_URL and TOTP_SERVER_TOKEN are injected via runScript env or -e flags.
var url = (typeof TOTP_SERVER_URL !== 'undefined' && TOTP_SERVER_URL) || 'http://127.0.0.1:4567/otp';
var headers = {};
if (typeof TOTP_SERVER_TOKEN !== 'undefined' && TOTP_SERVER_TOKEN) {
  headers['X-OTP-Token'] = TOTP_SERVER_TOKEN;
}

var response = http.get(url, { headers: headers });
if (!response.ok) {
  throw new Error('TOTP server returned ' + response.status + ': ' + response.body);
}

var payload = json(response.body);
if (!payload.code || !/^\d{6}$/.test(payload.code)) {
  throw new Error('TOTP server returned an invalid code: ' + response.body);
}

output.otp = payload.code;
console.log('Fetched OTP with ' + payload.remaining + 's remaining');
