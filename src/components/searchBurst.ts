/**
 * Funkenflug beim Suchen.
 *
 * Drei Schichten, zusammen knapp eine Sekunde:
 *
 * 1. Ein Lichtlauf: ein Regenbogen-Verlauf läuft einmal um den Rand des
 *    Felds und verglimmt.
 * 2. Funken: schnelle, dünne Striche, die aus dem Rand schiessen und hart
 *    abbremsen – das Knackige.
 * 3. Glut: langsamere, leuchtende Punkte, die leicht flackern und etwas
 *    länger bleiben – die Tiefe.
 *
 * Von der Startseite aus (`launch`) steigt die Glut nach dem ersten Moment
 * nach oben, dorthin, wo gleich die Kopfzeile der Treffer steht: die
 * Bewegung zeigt, wohin es geht. Eine neue Suche in der Kopfzeile
 * (`refresh`) bekommt einen kleineren Ausbruch ohne diesen Zug.
 *
 * Die Farben kommen aus `--rainbow`, der laut Designsystem genau einer Sache
 * gehört: der aktiven Suche. Im dunklen Schema leuchten die Teilchen
 * additiv; auf hellem Grund würden sie dabei verblassen, dort wird normal
 * gezeichnet. Wer Bewegung reduziert hat, sieht nichts davon.
 *
 * Bewusst ohne React: eine eigene Leinwand über allem, die sich selbst
 * entfernt.
 */

type Mode = 'launch' | 'refresh';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  life: number;
  color: string;
}

interface Ember extends Spark {
  radius: number;
  phase: number;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function palette(): { colors: string[]; accent: string; dark: boolean } {
  const root = getComputedStyle(document.documentElement);
  const accent = root.getPropertyValue('--accent').trim() || '#2f6fd0';
  const colors = [...new Set(root.getPropertyValue('--rainbow').match(/#[0-9a-f]{6}/gi) ?? [])];
  return { colors: colors.length ? colors : [accent], accent, dark: isDark() };
}

/** Dunkler Grund? Gemessen an der tatsächlichen Hintergrundfarbe, nicht an der Einstellung. */
function isDark(): boolean {
  const match = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
  if (!match) return false;
  const [r, g, b] = match.map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/** Ein Punkt auf dem Rand des Rechtecks und die Richtung nach aussen. */
function edgePoint(rect: DOMRect): { x: number; y: number; nx: number; ny: number } {
  let t = Math.random() * 2 * (rect.width + rect.height);
  if (t < rect.width) return { x: rect.left + t, y: rect.top, nx: 0, ny: -1 };
  if ((t -= rect.width) < rect.height) return { x: rect.right, y: rect.top + t, nx: 1, ny: 0 };
  if ((t -= rect.height) < rect.width) return { x: rect.right - t, y: rect.bottom, nx: 0, ny: 1 };
  t -= rect.width;
  return { x: rect.left, y: rect.bottom - t, nx: -1, ny: 0 };
}

/** Richtung nach aussen, um bis zu ±spread/2 gedreht, mal Tempo. */
function launchVelocity(nx: number, ny: number, speed: number, spread: number) {
  const angle = (Math.random() - 0.5) * spread;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { vx: (nx * cos - ny * sin) * speed, vy: (nx * sin + ny * cos) * speed };
}

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

export function particleBurst(rect: DOMRect, { mode = 'launch', radius = 10 }: { mode?: Mode; radius?: number } = {}): void {
  if (prefersReducedMotion() || rect.width === 0) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: 'none',
    zIndex: '60',
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const { colors, accent, dark } = palette();
  const launch = mode === 'launch';
  const scale = launch ? 1 : 0.55;

  const sparks: Spark[] = Array.from({ length: Math.round(70 * scale) }, () => {
    const p = edgePoint(rect);
    const v = launchVelocity(p.nx, p.ny, (320 + Math.random() * 700) * (launch ? 1 : 0.75), 1.2);
    return {
      x: p.x,
      y: p.y,
      ...v,
      width: 0.9 + Math.random() * 1.6,
      life: 240 + Math.random() * 280,
      color: pick(colors),
    };
  });

  const embers: Ember[] = Array.from({ length: Math.round(34 * scale) }, () => {
    const p = edgePoint(rect);
    const v = launchVelocity(p.nx, p.ny, 70 + Math.random() * 210, 1.6);
    return {
      x: p.x,
      y: p.y,
      ...v,
      width: 0,
      radius: 1.4 + Math.random() * 2.4,
      life: 560 + Math.random() * 420,
      color: pick(colors),
      phase: Math.random() * Math.PI * 2,
    };
  });

  // So lang wie der Wechsel zu den Treffern: der Ring soll nicht um ein Feld
  // glühen, das schon weg ist. Nur die Glut steigt danach noch in die Kopfzeile.
  const SWEEP_MS = 400;
  const start = performance.now();
  let last = start;

  const frame = (now: number) => {
    const age = now - start;
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';

    /* ---- 1. Lichtlauf um den Rand ---- */
    if (age < SWEEP_MS) {
      const p = age / SWEEP_MS;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const gradient = ctx.createConicGradient(-Math.PI / 2 + p * Math.PI * 2.2, cx, cy);
      colors.forEach((color, i) => gradient.addColorStop(i / colors.length, color));
      gradient.addColorStop(1, colors[0]);
      const grow = (1 - (1 - p) ** 3) * 6;
      ctx.save();
      ctx.globalAlpha = (1 - p) ** 1.4;
      ctx.lineWidth = 2.5 * (1 - p) + 0.75;
      ctx.strokeStyle = gradient;
      if (dark) {
        ctx.shadowColor = accent;
        ctx.shadowBlur = 14 * (1 - p);
      }
      roundedRect(ctx, rect.left - grow, rect.top - grow, rect.width + grow * 2, rect.height + grow * 2, radius + grow);
      ctx.stroke();
      ctx.restore();
    }

    let alive = 0;

    /* ---- 2. Funken: Strich in Flugrichtung, harte Bremse ---- */
    const sparkDrag = Math.exp(-dt * 7.5);
    ctx.lineCap = 'round';
    for (const spark of sparks) {
      if (age > spark.life) continue;
      alive++;
      spark.vx *= sparkDrag;
      spark.vy = spark.vy * sparkDrag + (launch ? -120 : 180) * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      const p = age / spark.life;
      ctx.globalAlpha = (1 - p) ** 1.5;
      ctx.strokeStyle = spark.color;
      ctx.lineWidth = spark.width * (1 - p * 0.5);
      ctx.beginPath();
      ctx.moveTo(spark.x, spark.y);
      ctx.lineTo(spark.x - spark.vx * 0.032, spark.y - spark.vy * 0.032);
      ctx.stroke();
    }

    /* ---- 3. Glut: leuchtende Punkte, flackernd; beim Start steigen sie auf ---- */
    const emberDrag = Math.exp(-dt * 3.2);
    for (const ember of embers) {
      if (age > ember.life) continue;
      alive++;
      ember.vx *= emberDrag;
      // Erst auseinander, dann – beim Wechsel zu den Treffern – nach oben,
      // wo gleich die Kopfzeile steht.
      const lift = launch && age > 140 ? -1400 : -60;
      ember.vy = ember.vy * emberDrag + lift * dt;
      ember.x += ember.vx * dt;
      ember.y += ember.vy * dt;
      const p = age / ember.life;
      const twinkle = 0.65 + 0.35 * Math.sin(ember.phase + age / 38);
      const alpha = (1 - p) ** 1.2 * twinkle;
      const r = ember.radius * (1 - p * 0.4);
      if (dark) {
        const glow = ctx.createRadialGradient(ember.x, ember.y, 0, ember.x, ember.y, r * 4);
        glow.addColorStop(0, ember.color);
        glow.addColorStop(1, 'transparent');
        ctx.globalAlpha = alpha * 0.45;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(ember.x, ember.y, r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ember.color;
      ctx.beginPath();
      ctx.arc(ember.x, ember.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (alive > 0 || age < SWEEP_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Wartet, bis die Bildschirmtastatur eingeklappt ist – sonst startete der
 * Funkenflug an einer Stelle, an der das Feld gleich nicht mehr steht.
 * Ohne offene Tastatur sofort, sonst bis die Ansicht wieder ihre volle Höhe
 * hat, längstens 350 ms.
 */
export function keyboardClosed(): Promise<void> {
  const viewport = window.visualViewport;
  const open = () => !!viewport && viewport.height < window.innerHeight * 0.85;
  if (!open()) return Promise.resolve();
  return new Promise((resolve) => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      viewport!.removeEventListener('resize', onResize);
      clearTimeout(timeout);
      clearTimeout(settle);
      resolve();
    };
    const onResize = () => {
      if (!open()) {
        clearTimeout(settle);
        settle = setTimeout(done, 40);
      }
    };
    viewport!.addEventListener('resize', onResize);
    const timeout = setTimeout(done, 350);
  });
}
