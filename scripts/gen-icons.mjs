// 產生 PNG 圖示（跟 public/icons/icon.svg 同樣的圖案），不用額外套件
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const RED = [217, 83, 79, 255], WHITE = [255, 255, 255, 255], PINK = [251, 233, 232, 255];

const inRR = (x, y, rx, ry, w, h, r) => {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inHeart = (x, y) => {
  if ((x - 231) ** 2 + (y - 292) ** 2 <= 36 * 36) return true;
  if ((x - 281) ** 2 + (y - 292) ** 2 <= 36 * 36) return true;
  // 下半部三角形
  if (y < 300 || y > 376) return false;
  const half = 61 * (1 - (y - 300) / 76);
  return Math.abs(x - 256) <= half;
};

// 回傳 512 座標系某點的顏色；mono = 通知列小圖示（白色剪影）
function shade(x, y, { maskable, mono }) {
  // maskable：滿版底色，內容縮到中間 80%
  if (maskable) { x = 256 + (x - 256) / 0.8; y = 256 + (y - 256) / 0.8; }
  const tab = inRR(x, y, 160, 96, 32, 72, 16) || inRR(x, y, 320, 96, 32, 72, 16);
  const card = inRR(x, y, 104, 128, 304, 280, 28);
  if (mono) {
    if (tab) return WHITE;
    if (card && !inHeart(x, y) && !(y > 196 && y < 208)) return WHITE;
    return [0, 0, 0, 0];
  }
  if (tab) return WHITE;
  if (card) {
    if (inHeart(x, y)) return RED;
    if (y < 200) return PINK;
    return WHITE;
  }
  if (maskable || inRR(x, y, 0, 0, 512, 512, 96)) return RED;
  return [0, 0, 0, 0];
}

function render(size, opts) {
  const ss = 4; // 每像素 4x4 取樣抗鋸齒
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = shade(((px + (sx + 0.5) / ss) / size) * 512, ((py + (sy + 0.5) / ss) / size) * 512, opts);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
      const o = 1 + px * 4;
      row[o] = a ? Math.round(r / a) : 0;
      row[o + 1] = a ? Math.round(g / a) : 0;
      row[o + 2] = a ? Math.round(b / a) : 0;
      row[o + 3] = Math.round(a / (ss * ss));
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

function png(w, h, raw) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), render(192, {}));
writeFileSync(new URL('icon-512.png', out), render(512, {}));
writeFileSync(new URL('icon-maskable-512.png', out), render(512, { maskable: true }));
writeFileSync(new URL('badge-96.png', out), render(96, { mono: true }));
console.log('icons written');
