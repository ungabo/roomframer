/* dimensions.js — Architectural dimension strings on an HTML5 canvas.
 *
 * All drawing here assumes the CANVAS TRANSFORM is already set so that
 * wall-space (0..wallLengthIn, 0..wallHeightIn) maps to an upright coordinate
 * system with Y growing UPWARD.
 *
 * The drawing uses CANVAS PIXELS for text/tick sizes (not wall inches) so
 * labels stay readable at any zoom.  To do that we pass a `pxScale` = pixels
 * per inch.
 *
 * Public API:
 *   Dims.drawHorizontalString(ctx, ticks, wallY, rowPx, pxScale, mode, opts)
 *   Dims.drawVerticalString(ctx, ticks, wallX, rowPx, pxScale, mode, opts)
 *
 * `ticks` is an ordered array of numeric wall-space positions.  A label is
 * drawn between each consecutive pair showing the distance (in user units).
 */
(function (global) {
  "use strict";

  const TXT_FONT_PX = 11;
  const TICK_LEN_PX = 8;            // the small 45° tick slash
  const EXT_GAP_PX  = 4;            // gap between wall edge and extension line start
  const EXT_OVER_PX = 6;            // extension line overshoot past dim line
  const LABEL_PAD   = 3;            // white pad around label text

  function setLineStyle(ctx, style) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = style || "#222";
    ctx.fillStyle   = "#222";
    ctx.font = TXT_FONT_PX + "px system-ui, Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
  }

  // Draw short 45° tick mark at (px, py). Axis "h" draws for a horizontal
  // dimension line (tick slopes up-right); "v" for vertical.
  function drawTick(ctx, px, py, axis) {
    const L = TICK_LEN_PX / 2;
    ctx.beginPath();
    if (axis === "h") {
      ctx.moveTo(px - L, py + L);
      ctx.lineTo(px + L, py - L);
    } else {
      ctx.moveTo(px - L, py - L);
      ctx.lineTo(px + L, py + L);
    }
    ctx.stroke();
  }

  /**
   * Horizontal dimension row under the wall.
   *   ticks:   array of wall-space X values (inches), sorted ascending.
   *   wallYpx: canvas Y of the wall bottom in PIXELS (screen space).
   *   rowPx:   distance BELOW the wall for this dimension line (pixels).
   *   pxScale: pixels per inch (horizontal scale).
   *   mode:    units mode string ("ftin" or "inches").
   *   opts:    { leftPx: canvas x of wall x=0, color }
   */
  function drawHorizontalString(ctx, ticks, wallYpx, rowPx, pxScale, mode, opts) {
    if (!ticks || ticks.length < 2) return;
    opts = opts || {};
    ctx.save();
    setLineStyle(ctx, opts.color);

    const dimY = wallYpx + rowPx;
    const xOf = (v) => opts.leftPx + v * pxScale;

    // Extension lines
    ctx.beginPath();
    for (const t of ticks) {
      const xp = xOf(t);
      ctx.moveTo(xp, wallYpx + EXT_GAP_PX);
      ctx.lineTo(xp, dimY + EXT_OVER_PX);
    }
    ctx.stroke();

    // Dimension line (continuous from first to last tick)
    const xStart = xOf(ticks[0]);
    const xEnd   = xOf(ticks[ticks.length - 1]);
    ctx.beginPath();
    ctx.moveTo(xStart, dimY);
    ctx.lineTo(xEnd,   dimY);
    ctx.stroke();

    // Ticks
    for (const t of ticks) drawTick(ctx, xOf(t), dimY, "h");

    // Labels between ticks
    for (let i = 1; i < ticks.length; i++) {
      const a = ticks[i - 1], b = ticks[i];
      const dist = b - a;
      if (dist <= 0) continue;
      const label = Units.formatShort(dist, mode);
      const mid = (xOf(a) + xOf(b)) / 2;
      const segPx = xOf(b) - xOf(a);
      drawDimLabel(ctx, label, mid, dimY, segPx, "h");
    }
    ctx.restore();
  }

  /**
   * Vertical dimension row to the right of the wall.
   *   ticks:   array of wall-space Y values (inches), sorted ascending.
   *   wallXpx: canvas X of the wall right edge in PIXELS.
   *   rowPx:   distance RIGHT of the wall for this dimension line (pixels).
   *   pxScale: pixels per inch (vertical scale, same as horizontal typically).
   *   mode:    units mode string.
   *   opts:    { bottomPx: canvas Y of wall y=0, color }
   */
  function drawVerticalString(ctx, ticks, wallXpx, rowPx, pxScale, mode, opts) {
    if (!ticks || ticks.length < 2) return;
    opts = opts || {};
    ctx.save();
    setLineStyle(ctx, opts.color);

    const dir = rowPx >= 0 ? 1 : -1;
    const dimX = wallXpx + rowPx;
    const yOf = (v) => opts.bottomPx - v * pxScale;

    ctx.beginPath();
    for (const t of ticks) {
      const yp = yOf(t);
      ctx.moveTo(wallXpx + EXT_GAP_PX * dir, yp);
      ctx.lineTo(dimX + EXT_OVER_PX * dir, yp);
    }
    ctx.stroke();

    const yStart = yOf(ticks[0]);
    const yEnd   = yOf(ticks[ticks.length - 1]);
    ctx.beginPath();
    ctx.moveTo(dimX, yStart);
    ctx.lineTo(dimX, yEnd);
    ctx.stroke();

    for (const t of ticks) drawTick(ctx, dimX, yOf(t), "v");

    for (let i = 1; i < ticks.length; i++) {
      const a = ticks[i - 1], b = ticks[i];
      const dist = b - a;
      if (dist <= 0) continue;
      const label = Units.formatShort(dist, mode);
      const mid = (yOf(a) + yOf(b)) / 2;
      const segPx = Math.abs(yOf(a) - yOf(b));
      drawDimLabel(ctx, label, dimX, mid, segPx, "v");
    }
    ctx.restore();
  }

  // Place a label near (cx, cy). If segment (segPx) is too small for the text,
  // the label is rotated 90° and/or shifted outside, avoiding overlap.
  function drawDimLabel(ctx, text, cx, cy, segPx, axis) {
    const m = ctx.measureText(text);
    const tw = m.width;
    const th = TXT_FONT_PX;
    const fits = segPx > tw + LABEL_PAD * 2;

    ctx.save();
    // Position:
    if (axis === "h") {
      // horizontal dim line: label above the line, centered between ticks.
      if (fits) {
        paintLabel(ctx, text, cx, cy - (th / 2 + 2), tw, th, 0);
      } else {
        // Rotate 90°: label reads bottom-to-top, placed slightly above line.
        paintLabel(ctx, text, cx, cy - (tw / 2 + 4), tw, th, -Math.PI / 2);
      }
    } else {
      // vertical dim line: label rotated 90° to the LEFT of the line.
      if (fits) {
        paintLabel(ctx, text, cx - (th / 2 + 2), cy, tw, th, -Math.PI / 2);
      } else {
        // Too-tight segment: small horizontal label right of line
        paintLabel(ctx, text, cx + tw / 2 + 6, cy, tw, th, 0);
      }
    }
    ctx.restore();
  }

  function paintLabel(ctx, text, cx, cy, tw, th, rot) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot || 0);
    // white background behind text
    ctx.fillStyle = "#fff";
    ctx.fillRect(-tw / 2 - LABEL_PAD, -th / 2 - 1, tw + LABEL_PAD * 2, th + 2);
    ctx.fillStyle = "#222";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  global.Dims = {
    drawHorizontalString,
    drawVerticalString,
    TXT_FONT_PX,
  };
})(window);
