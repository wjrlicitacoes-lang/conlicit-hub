#!/usr/bin/env node
// Gera os ícones PNG para a extensão ConlicitHub Monitor
// Uso: node create-icons.js
// Requer apenas módulos nativos do Node.js

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// CRC32 (necessário para chunks PNG)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

// Desenha ícone: fundo escuro #182A39, círculo #4CC5D7, letra "C" branca
function createIcon(size) {
  const BG  = [0x18, 0x2A, 0x39]; // #182A39
  const FG  = [0x4C, 0xC5, 0xD7]; // #4CC5D7
  const TXT = [0xFF, 0xFF, 0xFF]; // branco

  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const R = size * 0.42; // raio do círculo externo
  const ri = size * 0.27; // raio interno (anel)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Letra "C" — arco: círculo meio excluindo quadrante direito
      const angle = Math.atan2(dy, dx); // -π a π
      const inArc = dist >= ri && dist <= R;
      const openAngle = 0.65; // abertura do "C" (radianos de cada lado)
      const isOpen = angle > -openAngle && angle < openAngle; // abertura à direita

      let r, g, b, a;
      if (inArc && !isOpen) {
        [r, g, b, a] = [...TXT, 255];
      } else if (dist <= R + 1.5) {
        [r, g, b, a] = [...FG, dist > R ? Math.round(255 * (1 - (dist - R) / 1.5)) : 255];
      } else {
        [r, g, b, a] = [...BG, 255];
      }

      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
    }
  }

  // Monta PNG (RGBA, 8 bits)
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Scanlines com filtro None (0) por linha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const png = createIcon(size);
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`✓ icons/icon${size}.png (${png.length} bytes)`);
}

console.log('\nÍcones gerados! Agora você pode carregar a extensão no Chrome.');
