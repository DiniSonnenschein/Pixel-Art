// Erzeugt das App-Icon (ein Pixel-Bleistift) in allen Android-Auflösungen.
import { writeFileSync, mkdirSync } from 'node:fs';
import { encodePNG } from '../src/png.js';

const BG = [0x16, 0x16, 0x1c, 255];
const C = {
  k: [0x1b, 0x12, 0x06, 255], // Kontur
  g: [0x3a, 0x3a, 0x47, 255], // Mine
  w: [0xff, 0xcc, 0xaa, 255], // Holz
  y: [0xff, 0xb3, 0x47, 255], // Lack
  o: [0xe0, 0x7a, 0x2f, 255], // Lack-Schatten
  s: [0xc2, 0xc3, 0xc7, 255], // Metall
  p: [0xff, 0x77, 0xa8, 255], // Radiergummi
};

// 16×16: Bleistift diagonal, Spitze unten links
function art() {
  const grid = Array.from({ length: 16 }, () => Array(16).fill(null));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = x + y - 15; // Abstand zur Achse
      const t = x - y; // Position entlang der Achse (-12 = Spitze, 12 = Ende)
      if (t < -12 || t > 12) continue;
      const width = t < -6 ? Math.min(3, Math.floor((t + 12) / 2)) : 3; // Spitze verjüngt sich
      const ad = Math.abs(d);
      if (ad > width) continue;
      let c;
      if (ad === width && t > -11) c = 'k';
      else if (t <= -10) c = 'g';
      else if (t <= -6) c = 'w';
      else if (t <= 5) c = d > 0 ? 'o' : 'y';
      else if (t <= 7) c = 's';
      else c = 'p';
      if (t >= 12) c = 'k';
      grid[y][x] = c;
    }
  }
  return grid;
}

function render(cells, offset, cellPx, size, { bg = null, round = false } = {}) {
  const px = new Uint8ClampedArray(size * size * 4);
  const grid = art();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let col = bg;
      if (round) {
        const r = size / 2, dx = x + 0.5 - r, dy = y + 0.5 - r;
        if (dx * dx + dy * dy > r * r) col = null;
      }
      const gx = Math.floor(x / cellPx) - offset, gy = Math.floor(y / cellPx) - offset;
      if (col !== null || !bg) {
        const key = gx >= 0 && gy >= 0 && gx < 16 && gy < 16 ? grid[gy][gx] : null;
        if (key) col = C[key];
      }
      if (col) px.set(col, (y * size + x) * 4);
    }
  }
  return px;
}

const res = 'android/app/src/main/res';
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, f] of Object.entries(densities)) {
  mkdirSync(`${res}/mipmap-${name}`, { recursive: true });
  // Adaptiver Vordergrund: 108dp, Raster 27 Zellen -> 4dp pro Zelle
  const fg = 108 * f;
  writeFileSync(`${res}/mipmap-${name}/ic_launcher_foreground.png`, await encodePNG(fg, fg, render(27, 6, 4 * f, fg)));
  // Klassisches Icon: 48dp, Raster 24 Zellen -> 2dp pro Zelle
  const legacy = 48 * f;
  writeFileSync(`${res}/mipmap-${name}/ic_launcher.png`, await encodePNG(legacy, legacy, render(24, 4, 2 * f, legacy, { bg: BG })));
  writeFileSync(`${res}/mipmap-${name}/ic_launcher_round.png`, await encodePNG(legacy, legacy, render(24, 4, 2 * f, legacy, { bg: BG, round: true })));
}
// Vorschau für die README
writeFileSync('docs/icon.png', await encodePNG(192, 192, render(24, 4, 8, 192, { bg: BG })));
console.log('Icons erzeugt');
