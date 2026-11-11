// Generates tray icons (a ring with a dark core) as PNGs with no dependencies.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// ring + tilted disk stroke, supersampled
function shape(x, y, s, color) {
  let cov = 0;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    const u = ((x + (sx + 0.5) / 4) / s) * 2 - 1;
    const v = ((y + (sy + 0.5) / 4) / s) * 2 - 1;
    const r = Math.hypot(u, v);
    const ring = r > 0.42 && r < 0.62;
    const a = -0.35; const du = u * Math.cos(a) - v * Math.sin(a); const dv = u * Math.sin(a) + v * Math.cos(a);
    const disk = Math.abs(dv) < 0.09 && Math.abs(du) < 0.98 && r > 0.3;
    if (ring || disk) cov++;
  }
  const al = Math.round((cov / 16) * 255);
  return [...color, al];
}
const out = path.join(__dirname, '..', 'src', 'assets');
fs.writeFileSync(path.join(out, 'trayTemplate.png'), png(18, (x, y, s) => shape(x, y, s, [0, 0, 0])));
fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), png(36, (x, y, s) => shape(x, y, s, [0, 0, 0])));
fs.writeFileSync(path.join(out, 'tray.png'), png(32, (x, y, s) => shape(x, y, s, [150, 190, 255])));
console.log('tray icons written');
