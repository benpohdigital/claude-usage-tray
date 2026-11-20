// Draws the menu bar image: a 22 x 8 pt rounded bar (outline + fill) with an
// optional warning dot. Rendered by hand into a raw bitmap at 2x.
// Always a template image, so macOS tints it like every other menu bar icon.
const { nativeImage } = require('electron');

const SCALE = 2;
const W = 27, H = 16;              // points; bar is 22 x 8, the rest is room for the dot
const BAR = { x: 0.5, y: 4, w: 22, h: 8, r: 4 };
const DOT = { cx: 24.5, cy: 3.5, r: 2.2 };

// Signed distance from (px, py) to a rounded rectangle (negative inside).
function sdRoundRect(px, py, { x, y, w, h, r }) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const cover = (d) => Math.max(0, Math.min(1, 0.5 - d * SCALE));

// state: { percent: number|null, alert: boolean }
// percent null = no data (faint, empty bar).
function drawIcon({ percent, alert }) {
  const ink = percent == null ? 0.35 : 1;
  const pw = W * SCALE, ph = H * SCALE;
  const buf = Buffer.alloc(pw * ph * 4);
  const inner = { x: BAR.x + 1.5, y: BAR.y + 1.5, w: BAR.w - 3, h: BAR.h - 3, r: BAR.r - 1.5 };
  const fillW = percent == null ? 0 : (inner.w * Math.max(0, Math.min(100, percent))) / 100;

  for (let j = 0; j < ph; j++) {
    for (let i = 0; i < pw; i++) {
      const px = (i + 0.5) / SCALE, py = (j + 0.5) / SCALE;
      let a = 0;
      const over = (alpha) => { a = alpha + a * (1 - alpha); };

      over(cover(Math.abs(sdRoundRect(px, py, BAR) + 0.5) - 0.5) * ink);   // 1 pt outline
      if (fillW > 0) {
        const clip = Math.max(0, Math.min(1, (inner.x + fillW - px) * SCALE + 0.5));
        over(cover(sdRoundRect(px, py, inner)) * clip * ink);
      }
      if (alert) over(cover(Math.hypot(px - DOT.cx, py - DOT.cy) - DOT.r));

      buf[(j * pw + i) * 4 + 3] = Math.round(a * 255);   // black BGRA; only alpha matters
    }
  }

  const img = nativeImage.createFromBuffer(buf, { width: pw, height: ph, scaleFactor: SCALE });
  img.setTemplateImage(true);
  return img;
}

module.exports = { drawIcon };
