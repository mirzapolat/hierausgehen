/**
 * Zeichnet das App-Icon in allen Grössen aus einer einzigen Idee: ein dicker
 * Ring auf Weiss, rundum in einem durchgehenden Regenbogen.
 *
 * Der Ring steht für den Kreislauf der Tage und für den Ort, an dem man
 * gerade ist: „hier". Er ist geschlossen, ohne Anfang und Ende; die Farben
 * gehen ohne Naht ineinander über. Ein leiser Schein in denselben Farben lässt
 * ihn leuchten, ohne dass er eine Kante oder einen Schatten bräuchte.
 *
 * Gerechnet wird Pixel für Pixel statt über SVG: SVG kennt keinen
 * Kegelverlauf, und so ist die Kante analytisch geglättet und die Farbe in
 * OKLab gemischt, ohne die schmutzigen Übergänge eines HSV-Regenbogens.
 *
 *   npm run icons
 */
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

/** Die Farben im Uhrzeigersinn, oben beginnend. Der letzte Ton läuft in den ersten zurück. */
const STOPS = ['#ff2d55', '#ff7a00', '#ffcc00', '#34d17a', '#00b8f0', '#3d5afe', '#a23dff'];

interface Mark {
  /** Radius der Ringmitte, Anteil der Kantenlänge. */
  radius: number;
  /** Halbe Ringstärke, Anteil der Kantenlänge. */
  half: number;
  /** Stärke des farbigen Scheins (0 = keiner). */
  glow: number;
  /** Weisse Fläche oder durchsichtig. */
  background: boolean;
}

/** Die App-Marke: grosszügig Weiss ringsum, der Ring sitzt ruhig in der Mitte. */
const APP: Mark = { radius: 0.29, half: 0.075, glow: 0.2, background: true };
/** Für Android-Masken: alles innerhalb des sicheren Kreises (40 %). */
const MASKABLE: Mark = { radius: 0.25, half: 0.064, glow: 0.2, background: true };
/** Im Browser-Tab: ohne Fläche, kräftiger, damit er bei 16 px noch ein Ring ist. */
const FAVICON: Mark = { radius: 0.33, half: 0.13, glow: 0, background: false };

function hexToOklab(hex: string): [number, number, number] {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [channel(1), channel(3), channel(5)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, A, B]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  }) as [number, number, number];
}

const LAB = STOPS.map(hexToOklab);

/**
 * Farbe an Position `t` (0–1) rundum, zwischen den Stopps gleichmässig
 * gemischt: so bleibt keine Farbe als Band stehen, der Ring dreht sich.
 */
function colorAt(t: number): [number, number, number] {
  const scaled = t * LAB.length;
  const i = Math.floor(scaled) % LAB.length;
  const f = scaled - Math.floor(scaled);
  const a = LAB[i];
  const b = LAB[(i + 1) % LAB.length];
  return oklabToRgb([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

function render(size: number, mark: Mark): Promise<Buffer> {
  const pixels = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const radius = mark.radius * size;
  const half = mark.half * size;
  const sigma = 0.05 * size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const distance = Math.abs(Math.hypot(dx, dy) - radius) - half;
      // Oben beginnend, im Uhrzeigersinn.
      const t = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
      const [r, g, b] = colorAt(t);

      // Analytische Kantenglättung: Abdeckung des Pixels durch das Band.
      const ring = Math.min(1, Math.max(0, 0.5 - distance));
      const glow = mark.glow * Math.exp(-((Math.max(0, distance) / sigma) ** 2));

      let alpha = ring + glow * (1 - ring);
      let [outR, outG, outB] = [r, g, b];
      if (mark.background) {
        // Auf Weiss gemischt, das Icon selbst bleibt deckend.
        outR = Math.round(255 + (r - 255) * alpha);
        outG = Math.round(255 + (g - 255) * alpha);
        outB = Math.round(255 + (b - 255) * alpha);
        alpha = 1;
      }

      const o = (y * size + x) * 4;
      pixels[o] = outR;
      pixels[o + 1] = outG;
      pixels[o + 2] = outB;
      pixels[o + 3] = Math.round(alpha * 255);
    }
  }

  return sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

/** ICO mit eingebetteten PNGs, das verstehen alle heutigen Browser. */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

const outputs: [string, number, Mark][] = [
  ['src/app/icon.png', 512, APP],
  ['src/app/apple-icon.png', 180, APP],
  ['public/icon-192.png', 192, APP],
  ['public/icon-512.png', 512, APP],
  ['public/icon-maskable-512.png', 512, MASKABLE],
];

for (const [path, size, mark] of outputs) {
  writeFileSync(path, await render(size, mark));
  console.log(`${path} (${size}px)`);
}

const favicon = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, png: await render(size, FAVICON) })),
);
writeFileSync('src/app/favicon.ico', ico(favicon));
console.log('src/app/favicon.ico (16, 32, 48px)');
