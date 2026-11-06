// Pure JavaScript TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30s step).
// Runs inside Maestro's GraalJS sandbox with no server and no app changes.
// Written in ES5 style so it also works if Rhino is enabled.
//
// Inputs (via runScript env or -e): TOTP_SECRET (base32), optional TOTP_MIN_REMAINING.
// Output: output.otp

function base32Decode(input) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  var clean = String(input).replace(/[\s=-]/g, '').toUpperCase();
  var bits = '';
  for (var i = 0; i < clean.length; i++) {
    var val = alphabet.indexOf(clean.charAt(i));
    if (val < 0) throw new Error('Invalid base32 character: ' + clean.charAt(i));
    bits += ('00000' + val.toString(2)).slice(-5);
  }
  var bytes = [];
  for (var j = 0; j + 8 <= bits.length; j += 8) {
    bytes.push(parseInt(bits.substr(j, 8), 2));
  }
  return bytes;
}

function sha1(bytes) {
  var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  var msg = bytes.slice();
  var bitLen = bytes.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  for (var i = 7; i >= 0; i--) msg.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);

  function rotl(n, b) { return ((n << b) | (n >>> (32 - b))) >>> 0; }

  for (var off = 0; off < msg.length; off += 64) {
    var w = [];
    for (var t = 0; t < 16; t++) {
      w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) |
              (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) >>> 0;
    }
    for (t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);

    var a = h0, b = h1, c = h2, d = h3, e = h4, f, k;
    for (t = 0; t < 80; t++) {
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      var temp = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  var out = [];
  var hs = [h0, h1, h2, h3, h4];
  for (var x = 0; x < 5; x++) {
    out.push((hs[x] >>> 24) & 0xff, (hs[x] >>> 16) & 0xff, (hs[x] >>> 8) & 0xff, hs[x] & 0xff);
  }
  return out;
}

function hmacSha1(key, message) {
  if (key.length > 64) key = sha1(key);
  var ipad = [], opad = [];
  for (var i = 0; i < 64; i++) {
    var kb = i < key.length ? key[i] : 0;
    ipad.push(kb ^ 0x36);
    opad.push(kb ^ 0x5c);
  }
  return sha1(opad.concat(sha1(ipad.concat(message))));
}

function totp(secretBase32, epochSeconds) {
  var counter = Math.floor(epochSeconds / 30);
  var msg = [];
  for (var i = 7; i >= 0; i--) {
    msg.push(i >= 4 ? 0 : (counter >>> (i * 8)) & 0xff);
  }
  var hash = hmacSha1(base32Decode(secretBase32), msg);
  var offset = hash[19] & 0x0f;
  var code = (((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) |
              (hash[offset + 2] << 8) | hash[offset + 3]) % 1000000;
  return ('000000' + code).slice(-6);
}

var secret = (typeof TOTP_SECRET !== 'undefined' && TOTP_SECRET) || '';
if (!secret) throw new Error('TOTP_SECRET is not set');

var minRemaining = Number((typeof TOTP_MIN_REMAINING !== 'undefined' && TOTP_MIN_REMAINING) || 5);
var now = Math.floor(Date.now() / 1000);
var remaining = 30 - (now % 30);

// If the window is nearly over, use the next one. ScotAccount accepts a
// small amount of skew, and the flow will type it within a few seconds.
if (remaining < minRemaining) {
  now += remaining;
  remaining = 30;
}

output.otp = totp(secret, now);
console.log('Generated OTP with ' + remaining + 's remaining in its window');
