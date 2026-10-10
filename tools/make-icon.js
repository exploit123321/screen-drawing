// Generates assets/icon.png (256x256) with no dependencies.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const S = 256, px = Buffer.alloc(S * S * 4);
const sdRound = (x, y, r) => { const q = [Math.abs(x - S / 2) - (S / 2 - 8 - r), Math.abs(y - S / 2) - (S / 2 - 8 - r)];
  return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0)) + Math.min(Math.max(q[0], q[1]), 0) - r; };
const segD = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); };
const path_ = [[60, 175], [100, 105], [140, 165], [196, 80]];
const cov = d => Math.max(0, Math.min(1, 0.5 - d));
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const i = (y * S + x) * 4, t = (x + y) / (2 * S);
  let c = [99 + 40 * t, 102 - 10 * t, 241 - 0 * t], a = cov(sdRound(x, y, 52));
  const dl = Math.min(...path_.slice(1).map((p, k) => segD(x, y, path_[k], p))) - 13;
  const l = cov(dl) * a; c = c.map(v => v * (1 - l) + 255 * l);
  const dd = Math.hypot(x - 196, y - 80) - 20, r = cov(dd) * a; c = [c[0] * (1 - r) + 255 * r, c[1] * (1 - r) + 59 * r, c[2] * (1 - r) + 48 * r];
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a * 255;
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = ~0; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); o.write(t, 4); d.copy(o, 8);
  o.writeUInt32BE(crc(o.subarray(4, 8 + d.length)), 8 + d.length); return o; };
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), png);
console.log('wrote assets/icon.png');
