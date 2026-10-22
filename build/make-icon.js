// Generates build/icon.png (256x256) with no dependencies: a target ring with a dot.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 256;
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    const dx = x - N / 2 + 0.5, dy = y - N / 2 + 0.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    let c = [0, 0, 0, 0];
    const aa = (edge, v) => Math.max(0, Math.min(1, edge - v + 0.5));
    if (d < 124) {
      const bg = aa(124, d);
      c = [24, 28, 46, Math.round(255 * bg)];
      const ring = Math.min(aa(d, 70) * aa(96, d) * 1, 1);
      const dot = aa(34, d);
      const mix = Math.max(ring, dot);
      c = [
        Math.round(c[0] * (1 - mix) + 99 * mix),
        Math.round(c[1] * (1 - mix) + 179 * mix),
        Math.round(c[2] * (1 - mix) + 237 * mix),
        c[3]
      ];
    }
    const o = y * (N * 4 + 1) + 1 + x * 4;
    raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = c[3];
  }
}

const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('wrote build/icon.png');
