import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function distToSegment(px, py, ax, ay, bx, by) {
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

function distToRoundedRect(px, py, x0, y0, x1, y1, r) {
  const qx = Math.max(x0 + r - px, px - (x1 - r), 0);
  const qy = Math.max(y0 + r - py, py - (y1 - r), 0);
  if (qx === 0 && qy === 0) {
    const dInside = Math.min(px - x0, x1 - px, py - y0, y1 - py);
    return -dInside;
  }
  return Math.hypot(qx, qy);
}

function pointInTriangle(px, py, x1, y1, x2, y2, x3, y3) {
  const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
  const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
  const has_neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const has_pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(has_neg && has_pos);
}

// Gold color interpolator
function getGoldColor(t) {
  t = clamp(t, 0, 1);
  if (t < 0.3) {
    const k = t / 0.3;
    return [
      Math.round(255 + (245 - 255) * k),
      Math.round(242 + (197 - 242) * k),
      Math.round(184 + (24 - 184) * k)
    ];
  } else if (t < 0.7) {
    const k = (t - 0.3) / 0.4;
    return [
      Math.round(245 + (229 - 245) * k),
      Math.round(197 + (169 - 197) * k),
      Math.round(24 + (61 - 24) * k)
    ];
  } else {
    const k = (t - 0.7) / 0.3;
    return [
      Math.round(229 + (179 - 229) * k),
      Math.round(169 + (120 - 169) * k),
      Math.round(61 + (18 - 61) * k)
    ];
  }
}

function renderIcon({ width, height, isForeground = false, isBackgroundOnly = false, scaleFactor = 1.0 }) {
  const png = new PNG({ width, height });
  const samples = 2; // 2x2 super-sampling for crisp anti-aliasing

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;

          // Normalized coordinates (0 to 1)
          const nx = px / width;
          const ny = py / height;

          // Scaled coordinates relative to center
          const cx = (nx - 0.5) / scaleFactor + 0.5;
          const cy = (ny - 0.5) / scaleFactor + 0.5;

          let r = 0, g = 0, b = 0, a = 0;

          if (isBackgroundOnly) {
            // Dark luxury background with gold ambient backlight
            r = 6; g = 6; b = 10; a = 255;
            const distGlow = Math.hypot(cx - 0.5, cy - 0.42);
            if (distGlow < 0.45) {
              const glowFactor = (1 - distGlow / 0.45) ** 2 * 0.4;
              r = clamp(r + 229 * glowFactor, 0, 255);
              g = clamp(g + 169 * glowFactor, 0, 255);
              b = clamp(b + 61 * glowFactor, 0, 255);
            }
          } else if (isForeground) {
            // Transparent background
            r = 0; g = 0; b = 0; a = 0;

            // Compute shapes in cx, cy space
            const frameX0 = 0.14, frameY0 = 0.17, frameX1 = 0.86, frameY1 = 0.69;
            const radius = 0.10;
            const strokeW = 0.045;

            // Outer Frame
            const dOuter = distToRoundedRect(cx, cy, frameX0, frameY0, frameX1, frameY1, radius);
            const dInner = distToRoundedRect(cx, cy, frameX0 + strokeW, frameY0 + strokeW, frameX1 - strokeW, frameY1 - strokeW, Math.max(0.02, radius - strokeW));

            // Stand Neck & Base
            const dNeck = distToSegment(cx, cy, 0.50, 0.67, 0.50, 0.785);
            const dBase = distToSegment(cx, cy, 0.30, 0.785, 0.70, 0.785);
            const isStand = Math.min(dNeck, dBase) <= strokeW / 2;

            if (dOuter <= 0 && dInner > 0) {
              // Frame stroke (Golden Gradient)
              const gradT = clamp((cx - frameX0 + cy - frameY0) / 1.4, 0, 1);
              const [gr, gg, gb] = getGoldColor(gradT);
              r = gr; g = gg; b = gb; a = 255;
            } else if (dInner <= 0) {
              // Inner screen fill
              r = 11; g = 11; b = 15; a = 255;

              // Diagonal glass sheen
              if (cx + cy * 0.8 < 0.55) {
                r = clamp(r + 35, 0, 255);
                g = clamp(g + 35, 0, 255);
                b = clamp(b + 40, 0, 255);
              }

              // Play Triangle inside screen
              const p1x = 0.43, p1y = 0.325;
              const p2x = 0.65, p2y = 0.430;
              const p3x = 0.43, p3y = 0.535;

              if (pointInTriangle(cx, cy, p1x, p1y, p2x, p2y, p3x, p3y)) {
                const playGradT = clamp((cx - p1x + cy - p1y) / 0.4, 0, 1);
                const [pr, pg, pb] = getGoldColor(playGradT);
                r = pr; g = pg; b = pb; a = 255;
              }
            } else if (isStand) {
              const [sr, sg, sb] = getGoldColor(0.5);
              r = sr; g = sg; b = sb; a = 255;
            }
          } else {
            // Full Icon (App Icon with dark background + TV Screen)
            r = 7; g = 7; b = 11; a = 255;

            // Ambient Gold Radial Backlight
            const distGlow = Math.hypot(cx - 0.5, cy - 0.43);
            if (distGlow < 0.42) {
              const glowFactor = (1 - distGlow / 0.42) ** 2 * 0.35;
              r = clamp(r + 229 * glowFactor, 0, 255);
              g = clamp(g + 169 * glowFactor, 0, 255);
              b = clamp(b + 61 * glowFactor, 0, 255);
            }

            // TV Frame Shapes
            const frameX0 = 0.14, frameY0 = 0.17, frameX1 = 0.86, frameY1 = 0.69;
            const radius = 0.10;
            const strokeW = 0.045;

            const dOuter = distToRoundedRect(cx, cy, frameX0, frameY0, frameX1, frameY1, radius);
            const dInner = distToRoundedRect(cx, cy, frameX0 + strokeW, frameY0 + strokeW, frameX1 - strokeW, frameY1 - strokeW, Math.max(0.02, radius - strokeW));

            const dNeck = distToSegment(cx, cy, 0.50, 0.67, 0.50, 0.785);
            const dBase = distToSegment(cx, cy, 0.30, 0.785, 0.70, 0.785);
            const isStand = Math.min(dNeck, dBase) <= strokeW / 2;

            if (dOuter <= 0 && dInner > 0) {
              const gradT = clamp((cx - frameX0 + cy - frameY0) / 1.4, 0, 1);
              const [gr, gg, gb] = getGoldColor(gradT);
              r = gr; g = gg; b = gb; a = 255;
            } else if (dInner <= 0) {
              r = 11; g = 11; b = 15; a = 255;

              if (cx + cy * 0.8 < 0.55) {
                r = clamp(r + 35, 0, 255);
                g = clamp(g + 35, 0, 255);
                b = clamp(b + 40, 0, 255);
              }

              const p1x = 0.43, p1y = 0.325;
              const p2x = 0.65, p2y = 0.430;
              const p3x = 0.43, p3y = 0.535;

              if (pointInTriangle(cx, cy, p1x, p1y, p2x, p2y, p3x, p3y)) {
                const playGradT = clamp((cx - p1x + cy - p1y) / 0.4, 0, 1);
                const [pr, pg, pb] = getGoldColor(playGradT);
                r = pr; g = pg; b = pb; a = 255;
              }
            } else if (isStand) {
              const [sr, sg, sb] = getGoldColor(0.5);
              r = sr; g = sg; b = sb; a = 255;
            }
          }

          rSum += r;
          gSum += g;
          bSum += b;
          aSum += a;
        }
      }

      const idx = (width * y + x) << 2;
      png.data[idx] = Math.round(rSum / 4);
      png.data[idx + 1] = Math.round(gSum / 4);
      png.data[idx + 2] = Math.round(bSum / 4);
      png.data[idx + 3] = Math.round(aSum / 4);
    }
  }

  return png;
}

function savePng(png, targetPath) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const buf = PNG.sync.write(png);
  fs.writeFileSync(targetPath, buf);
  console.log(`Saved ${targetPath} (${png.width}x${png.height})`);
}

async function main() {
  console.log('Generating SeenIt icons...');

  // 1. Web / Public PNGs
  savePng(renderIcon({ width: 512, height: 512 }), 'public/icon-512.png');
  savePng(renderIcon({ width: 192, height: 192 }), 'public/icon-192.png');
  savePng(renderIcon({ width: 512, height: 512 }), 'public/icon-maskable-512.png');
  savePng(renderIcon({ width: 192, height: 192 }), 'public/icon-maskable-192.png');
  savePng(renderIcon({ width: 512, height: 512 }), 'public/logo.png');
  savePng(renderIcon({ width: 64, height: 64 }), 'public/favicon.png');
  savePng(renderIcon({ width: 180, height: 180 }), 'public/apple-touch-icon.png');

  // 2. Android Mipmap Folders
  const androidMipmaps = [
    { dir: 'mipmap-mdpi', size: 48, foreSize: 108 },
    { dir: 'mipmap-hdpi', size: 72, foreSize: 162 },
    { dir: 'mipmap-xhdpi', size: 96, foreSize: 216 },
    { dir: 'mipmap-xxhdpi', size: 144, foreSize: 324 },
    { dir: 'mipmap-xxxhdpi', size: 192, foreSize: 432 },
    { dir: 'mipmap-ldpi', size: 36, foreSize: 81 },
  ];

  for (const m of androidMipmaps) {
    const baseDir = path.join('android/app/src/main/res', m.dir);
    // Legacy icon
    savePng(renderIcon({ width: m.size, height: m.size }), path.join(baseDir, 'ic_launcher.png'));
    savePng(renderIcon({ width: m.size, height: m.size }), path.join(baseDir, 'ic_launcher_round.png'));

    // Adaptive icon foreground (transparent background, scaled to 0.65 inside safe zone)
    savePng(renderIcon({ width: m.foreSize, height: m.foreSize, isForeground: true, scaleFactor: 0.65 }), path.join(baseDir, 'ic_launcher_foreground.png'));

    // Adaptive icon background
    savePng(renderIcon({ width: m.foreSize, height: m.foreSize, isBackgroundOnly: true }), path.join(baseDir, 'ic_launcher_background.png'));
  }

  console.log('All icons generated successfully!');
}

main().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
