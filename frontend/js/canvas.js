/* canvas.js — Wall elevation renderer with architectural dimensions.
 *
 * Public API (single instance on window.WallView):
 *   WallView.init({ canvas, getState, onSelectOpening, onOpeningChanged, onStatus })
 *   WallView.render()          - recompute + redraw
 *   WallView.setZoom(pct)      - 20..200
 *   WallView.fit()
 *   WallView.getComputed()     - last framing output
 */
(function (global) {
  "use strict";

  const MARGIN_TOP    = 44;
  const MARGIN_BOTTOM = 120;
  const MARGIN_LEFT   = 56;
  const MARGIN_RIGHT  = 140;

  const ROW_DIM_DETAIL  = 34;
  const ROW_DIM_OPENING = 68;
  const ROW_DIM_OVERALL = 104;

  const ROW_V_HEIGHTS = 50;
  const ROW_V_OVERALL = 100;

  const WallView = {
    _state: null,     // getState callback
    _cb: {},          // event callbacks
    _canvas: null,
    _ctx: null,
    _pxScale: 0.6 * 12 / 12 * 4,   // updated by setZoom
    _computed: null,
    _hover: null,
    _dragging: null,
  };

  WallView.init = function(opts) {
    this._state = opts.getState;
    this._cb = {
      onSelectOpening: opts.onSelectOpening || (() => {}),
      onOpeningChanged: opts.onOpeningChanged || (() => {}),
      onStatus: opts.onStatus || (() => {}),
    };
    this._canvas = opts.canvas;
    this._ctx = this._canvas.getContext("2d");
    this.setZoom(60);
    bindEvents(this);
  };

  WallView.setZoom = function(pct) {
    // 100% => 4 px per inch.  Range 20..200.
    this._pxScale = Math.max(0.4, Math.min(20, pct * 0.04));
    this._zoomPct = pct;
  };

  WallView.fit = function() {
    const s = this._state();
    if (!s) return 60;
    const wall = s.wall;
    // target: fit wall width into ~1100px
    const target = 1100 / wall.lengthIn; // px per inch
    const pct = Math.round(target / 0.04);
    this.setZoom(Math.max(20, Math.min(200, pct)));
    return this._zoomPct;
  };

  WallView.getComputed = function() { return this._computed; };

  // =====================================================================
  WallView.render = function(targetCanvas) {
    const canvas = targetCanvas || this._canvas;
    const ctx = canvas.getContext("2d");
    const s = this._state();
    if (!s) return;

    const mode = s.unitsMode;
    const framing = Framing.compute({ wall: s.wall, openings: s.openings });
    this._computed = framing;

    const px = this._pxScale;
    const wallWpx = s.wall.lengthIn * px;
    const wallHpx = s.wall.heightIn * px;

    // Extra space for roof overhangs + rafter depth above the wall.
    const meta = framing.meta;
    const isSlope = meta.roofStyle === "slope";
    const ovLowPx  = isSlope ? (meta.roofOverhangLowIn  || 0) * px : 0;
    const ovHighPx = isSlope ? (meta.roofOverhangHighIn || 0) * px : 0;
    const leftExtraPx  = meta.roofHighSide === "left"  ? ovHighPx : ovLowPx;
    const rightExtraPx = meta.roofHighSide === "right" ? ovHighPx : ovLowPx;
    const topExtraPx   = isSlope ? Math.max(0, (s.wall.roofRafterDepthIn || 5.5) * px + 12) : 0;

    canvas.width  = Math.ceil(MARGIN_LEFT + leftExtraPx + wallWpx + rightExtraPx + MARGIN_RIGHT);
    canvas.height = Math.ceil(MARGIN_TOP  + topExtraPx + wallHpx + MARGIN_BOTTOM);

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Optional grid
    if (s.showGrid) drawGrid(ctx, canvas, px);

    const wallLeftPx   = MARGIN_LEFT + leftExtraPx;
    const wallRightPx  = wallLeftPx + wallWpx;
    const wallTopPx    = MARGIN_TOP + topExtraPx;
    const wallBotPx    = wallTopPx + wallHpx;

    // Draw wall outline
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1.4;
    drawWallOutline(ctx, framing.meta, wallLeftPx, wallTopPx, wallBotPx, px);

    // Draw members
    const wallToPx = (mx, my, mw, mh) => ({
      x: wallLeftPx + mx * px,
      y: wallBotPx  - (my + mh) * px,
      w: mw * px,
      h: mh * px,
    });

    // Order: plates first (background), then ghosts, then framing members,
    // then opening outlines on top.
    const byKind = (kinds) => framing.members.filter(m => kinds.includes(m.kind));

    // Inside-wall members (clipped to wall shape)
    ctx.save();
    clipToWallShape(ctx, framing.meta, wallLeftPx, wallBotPx, px);
    drawMembers(ctx, byKind(["bottom_plate","top_plate","top_plate_slope"]), wallToPx, s);
    drawMembers(ctx, byKind(["window_ghost","door_ghost"]), wallToPx, s);
    drawMembers(ctx, byKind(["stud","king","jack","cripple_above","cripple_below","sill","header","rafter_mark"]), wallToPx, s);
    drawOpeningOutlines(ctx, framing.members, wallToPx, mode, s);
    ctx.restore();

    // Roof members (rafter, birdsmouth, fascia) render OUTSIDE the wall clip
    // so overhangs and the sloped rafter above the top plate are visible.
    drawMembers(ctx, byKind(["rafter"]), wallToPx, s);
    drawMembers(ctx, byKind(["fascia"]), wallToPx, s);
    drawMembers(ctx, byKind(["birdsmouth"]), wallToPx, s);

    // Dimensions
    if (s.showDims) {
      drawHorizontalDims(ctx, s, framing, wallLeftPx, wallBotPx, px, mode);
      drawVerticalDims(ctx,   s, framing, wallRightPx, wallBotPx, px, mode);
      drawTitleBlock(ctx,     s, framing, wallLeftPx, wallTopPx, wallWpx);
      drawPlanIndicator(ctx,  s, wallLeftPx, wallBotPx, wallWpx);
    }
  };

  // ---------- drawing helpers ----------
  function drawGrid(ctx, canvas, px) {
    ctx.save();
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 1;
    const step = 12 * px; // 1 ft grid
    ctx.beginPath();
    for (let x = 0; x < canvas.width; x += step)  { ctx.moveTo(x+0.5, 0); ctx.lineTo(x+0.5, canvas.height); }
    for (let y = 0; y < canvas.height; y += step) { ctx.moveTo(0, y+0.5); ctx.lineTo(canvas.width, y+0.5); }
    ctx.stroke();
    ctx.restore();
  }

  function drawMembers(ctx, members, wallToPx, s) {
    for (const m of members) {
      if (m.points) {
        drawPolygonMember(ctx, m, wallToPx, s);
        continue;
      }
      const r = wallToPx(m.x, m.y, m.w, m.h);
      ctx.fillStyle = s.colorCode ? m.color : (m.ghost ? m.color : "#efe7c7");
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#4a4a4a";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
  }

  function drawPolygonMember(ctx, member, wallToPx, s) {
    const pts = member.points.map((p) => wallToPx(p.x, p.y, 0, 0));
    ctx.beginPath();
    pts.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.save();
    if (member.ghost) ctx.globalAlpha = 0.55;
    ctx.fillStyle = s.colorCode ? member.color : "#efe7c7";
    ctx.fill();
    ctx.strokeStyle = "#4a4a4a";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  function drawWallOutline(ctx, meta, wallLeftPx, wallTopPx, wallBotPx, px) {
    if (meta.roofStyle !== "slope") {
      ctx.strokeRect(wallLeftPx + 0.5, wallTopPx + 0.5, meta.W * px, meta.H * px);
      return;
    }

    const leftTopPx = wallBotPx - meta.leftWallHeight * px;
    const rightTopPx = wallBotPx - meta.rightWallHeight * px;
    const wallRightPx = wallLeftPx + meta.W * px;

    ctx.beginPath();
    ctx.moveTo(wallLeftPx, wallBotPx);
    ctx.lineTo(wallLeftPx, leftTopPx);
    ctx.lineTo(wallRightPx, rightTopPx);
    ctx.lineTo(wallRightPx, wallBotPx);
    ctx.closePath();
    ctx.stroke();
  }

  function clipToWallShape(ctx, meta, wallLeftPx, wallBotPx, px) {
    const wallRightPx = wallLeftPx + meta.W * px;
    ctx.beginPath();
    if (meta.roofStyle !== "slope") {
      const topPx = wallBotPx - meta.H * px;
      ctx.moveTo(wallLeftPx, wallBotPx);
      ctx.lineTo(wallLeftPx, topPx);
      ctx.lineTo(wallRightPx, topPx);
      ctx.lineTo(wallRightPx, wallBotPx);
    } else {
      const leftTopPx = wallBotPx - meta.leftWallHeight * px;
      const rightTopPx = wallBotPx - meta.rightWallHeight * px;
      ctx.moveTo(wallLeftPx, wallBotPx);
      ctx.lineTo(wallLeftPx, leftTopPx);
      ctx.lineTo(wallRightPx, rightTopPx);
      ctx.lineTo(wallRightPx, wallBotPx);
    }
    ctx.closePath();
    ctx.clip();
  }

  function drawOpeningOutlines(ctx, members, wallToPx, mode, s) {
    // For each opening ghost, draw "DOOR"/"WINDOW" + dimensions inside if room.
    const ghosts = members.filter(m => m.ghost && (m.kind === "door_ghost" || m.kind === "window_ghost"));
    ctx.save();
    ctx.font = "12px system-ui, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const g of ghosts) {
      const r = wallToPx(g.x, g.y, g.w, g.h);
      // Check if this opening violates roof slope (header above roof line).
      const op = (s.openings || []).find(o => o.id === g.oid);
      const violates = op && !openingLeftIsValid(op.leftIn, op, s.wall);
      // emphasized outline
      ctx.strokeStyle = violates
        ? "#d33"
        : (g.kind === "door_ghost" ? "#555" : "#2a77c9");
      ctx.lineWidth = violates ? 2.4 : 1.6;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      if (violates) {
        ctx.save();
        ctx.fillStyle = "rgba(220,55,55,0.12)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = "#a11";
        ctx.font = "bold 11px system-ui, Arial, sans-serif";
        ctx.fillText("! HEADER ABOVE ROOF", r.x + r.w / 2, r.y - 8);
        ctx.restore();
      }
      // Label
      if (s.showLabels && r.h > 28) {
        ctx.fillStyle = "#333";
        const kindLabel = g.kind === "door_ghost" ? "DOOR" : "WINDOW";
        ctx.fillText(kindLabel, r.x + r.w / 2, r.y + 14);
        if (r.h > 48) {
          const sizeLabel = Units.formatShort(g.w, mode) + " × " + Units.formatShort(g.h, mode);
          ctx.fillText(sizeLabel, r.x + r.w / 2, r.y + r.h - 10);
        }
      }
    }
    ctx.restore();
  }

  function drawTitleBlock(ctx, s, framing, wallLeftPx, wallTopPx, wallWpx) {
    ctx.save();
    ctx.fillStyle = "#222";
    ctx.textBaseline = "alphabetic";
    ctx.font = "bold 13px system-ui, Arial, sans-serif";
    ctx.textAlign = "left";
    const title = s.projectName || "Wall";
    ctx.fillText(title, wallLeftPx, wallTopPx - 18);
    ctx.font = "11px system-ui, Arial, sans-serif";
    ctx.fillText(
      `${s.wall.studNominal} @ ${Units.formatShort(s.wall.spacingOC, s.unitsMode)} O.C.`
      + (s.wall.roofStyle === "slope"
        ? `  •  slope ${Units.formatShort(s.wall.roofPitchIn12, s.unitsMode)} in 12 (${s.wall.roofHighSide} high)`
        : "")
      + `  •  ${framing.summary.studCount} verticals`
      + `  •  ${framing.summary.netArea} ft²`,
      wallLeftPx, wallTopPx - 4
    );

    if (s.wall.roofStyle === "slope") {
      const arrowY = wallTopPx - 18;
      const x0 = wallLeftPx + wallWpx - 120;
      const x1 = wallLeftPx + wallWpx - 40;
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (s.wall.roofHighSide === "right") {
        ctx.moveTo(x0, arrowY);
        ctx.lineTo(x1, arrowY);
        ctx.lineTo(x1 - 7, arrowY - 4);
        ctx.moveTo(x1, arrowY);
        ctx.lineTo(x1 - 7, arrowY + 4);
        ctx.fillText("HIGH", x1 + 8, arrowY + 4);
      } else {
        ctx.moveTo(x1, arrowY);
        ctx.lineTo(x0, arrowY);
        ctx.lineTo(x0 + 7, arrowY - 4);
        ctx.moveTo(x0, arrowY);
        ctx.lineTo(x0 + 7, arrowY + 4);
        ctx.fillText("HIGH", x0 - 22, arrowY + 4);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Small plan-view (overhead) indicator showing slope direction for this wall.
  // Placed below the title block, above-left of the canvas.
  function drawPlanIndicator(ctx, s, wallLeftPx, wallBotPx, wallWpx) {
    const boxW = 140;
    const boxH = 54;
    const boxX = Math.max(6, wallLeftPx - 40);
    const boxY = wallBotPx + 68; // sits below dimension rows

    ctx.save();
    // background card
    ctx.fillStyle = "#fafafa";
    ctx.strokeStyle = "#aaa";
    ctx.lineWidth = 1;
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    // title
    ctx.fillStyle = "#444";
    ctx.font = "bold 10px system-ui, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("PLAN — ROOF SLOPE", boxX + 6, boxY + 13);

    // mini wall footprint rectangle
    const pad = 10;
    const innerY = boxY + 22;
    const innerH = 22;
    const innerX = boxX + pad;
    const innerW = boxW - pad * 2;
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.strokeRect(innerX + 0.5, innerY + 0.5, innerW - 1, innerH - 1);

    // this wall highlighted (the bottom edge represents "this wall")
    ctx.strokeStyle = "#2a77c9";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(innerX, innerY + innerH);
    ctx.lineTo(innerX + innerW, innerY + innerH);
    ctx.stroke();

    const isSlope = s.wall.roofStyle === "slope";
    if (isSlope) {
      // arrow from LOW side to HIGH side
      const highRight = s.wall.roofHighSide === "right";
      const ay = innerY + innerH / 2;
      const x0 = highRight ? innerX + 6 : innerX + innerW - 6;
      const x1 = highRight ? innerX + innerW - 6 : innerX + 6;
      ctx.strokeStyle = "#c65";
      ctx.fillStyle = "#c65";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, ay);
      ctx.lineTo(x1, ay);
      ctx.stroke();
      const dx = Math.sign(x1 - x0);
      ctx.beginPath();
      ctx.moveTo(x1, ay);
      ctx.lineTo(x1 - 8 * dx, ay - 4);
      ctx.lineTo(x1 - 8 * dx, ay + 4);
      ctx.closePath();
      ctx.fill();
      // HIGH / LOW labels
      ctx.fillStyle = "#444";
      ctx.font = "9px system-ui, Arial, sans-serif";
      ctx.textAlign = highRight ? "left" : "right";
      ctx.fillText("HIGH", highRight ? innerX + innerW + 2 : innerX - 2, ay + 3);
      ctx.textAlign = highRight ? "right" : "left";
      ctx.fillText("LOW",  highRight ? innerX - 2 : innerX + innerW + 2, ay + 3);
    } else {
      ctx.fillStyle = "#888";
      ctx.font = "10px system-ui, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("flat roof", innerX + innerW / 2, innerY + innerH / 2 + 3);
    }
    ctx.textAlign = "left";
    ctx.restore();
  }

  function drawHorizontalDims(ctx, s, framing, leftPx, botPx, px, mode) {
    const W = s.wall.lengthIn;

    // --- Row 1: framing detail (every vertical member centerline) ---
    const verticals = framing.members
      .filter(m => ["stud","king","jack","cripple_above","cripple_below"].includes(m.kind));
    const centers = [...new Set(verticals.map(m => round3(m.x + m.w / 2)))]
      .sort((a, b) => a - b);
    // prepend 0 and append W so the row spans the full wall
    const row1 = uniqSorted([0, ...centers, W]);
    Dims.drawHorizontalString(ctx, row1, botPx, ROW_DIM_DETAIL, px, mode, { leftPx });

    // --- Row 2: opening positions ---
    const openings = s.openings.slice().sort((a,b) => a.leftIn - b.leftIn);
    const row2 = [0];
    for (const o of openings) { row2.push(o.leftIn, o.leftIn + o.widthIn); }
    row2.push(W);
    Dims.drawHorizontalString(ctx, uniqSorted(row2), botPx, ROW_DIM_OPENING, px, mode, { leftPx });

    // --- Row 3: overall ---
    Dims.drawHorizontalString(ctx, [0, W], botPx, ROW_DIM_OVERALL, px, mode, { leftPx });
  }

  function drawVerticalDims(ctx, s, framing, rightPx, botPx, px, mode) {
    const meta = framing.meta;
    const rightHeight = meta.rightWallHeight;
    const leftHeight = meta.leftWallHeight;

    const pts = new Set([0, meta.bpTop, meta.rightRoofBottom, rightHeight]);
    for (const o of s.openings) {
      pts.add(o.headHeightIn);
      pts.add(o.headHeightIn + o.headerDepthIn);
      if (o.kind === "window") {
        pts.add(o.sillHeightIn);
        pts.add(o.sillHeightIn - (s.wall.studThickIn || 1.5));
      }
    }
    const row1 = [...pts].map(v => Math.max(0, Math.min(rightHeight, v))).sort((a,b) => a - b);
    Dims.drawVerticalString(ctx, uniqSorted(row1), rightPx, ROW_V_HEIGHTS, px, mode, { bottomPx: botPx });

    Dims.drawVerticalString(ctx, [0, rightHeight], rightPx, ROW_V_OVERALL, px, mode, { bottomPx: botPx });

    if (Math.abs(leftHeight - rightHeight) > 1e-4) {
      Dims.drawVerticalString(ctx, [0, leftHeight], MARGIN_LEFT, -ROW_V_OVERALL, px, mode, { bottomPx: botPx });
    }
  }

  function uniqSorted(arr) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const out = [];
    for (const v of sorted) {
      if (out.length === 0 || Math.abs(v - out[out.length - 1]) > 1e-4) out.push(v);
    }
    return out;
  }
  function round3(v) { return Math.round(v * 1000) / 1000; }

  // ---------- interaction ----------
  function bindEvents(self) {
    const canvas = self._canvas;

    const toWall = (evt) => {
      const rect = canvas.getBoundingClientRect();
      const cx = (evt.clientX - rect.left) * (canvas.width / rect.width);
      const cy = (evt.clientY - rect.top)  * (canvas.height / rect.height);
      const s = self._state();
      const wx = (cx - MARGIN_LEFT) / self._pxScale;
      const wy = (MARGIN_TOP + s.wall.heightIn * self._pxScale - cy) / self._pxScale;
      return { cx, cy, wx, wy };
    };

    const hitOpening = (wx, wy) => {
      const s = self._state();
      for (let i = s.openings.length - 1; i >= 0; i--) {
        const o = s.openings[i];
        const l = o.leftIn, r = l + o.widthIn;
        const bot = o.kind === "window" ? o.sillHeightIn : 0;
        const top = o.headHeightIn;
        if (wx >= l && wx <= r && wy >= bot && wy <= top) return { o, i };
      }
      return null;
    };

    canvas.addEventListener("mousemove", (e) => {
      const p = toWall(e);
      const s = self._state();
      self._cb.onStatus(
        `x: ${Units.formatShort(clamp(p.wx, 0, s.wall.lengthIn), s.unitsMode)}  ` +
        `y: ${Units.formatShort(clamp(p.wy, 0, s.wall.heightIn), s.unitsMode)}`
      );
      if (self._dragging) {
        const drag = self._dragging;
        let newLeft = drag.origLeft + (p.wx - drag.startWx);
        // snap to 1/16"
        newLeft = Math.round(newLeft * 16) / 16;
        // clamp inside wall
        const o = s.openings[drag.idx];
        newLeft = Math.max(0, Math.min(s.wall.lengthIn - o.widthIn, newLeft));
        const rawCandidate = newLeft;
        newLeft = findNearestValidOpeningLeft(newLeft, o, s.wall, drag.origLeft);
        const wasBlocked = s.wall.roofStyle === "slope"
          && !openingLeftIsValid(rawCandidate, o, s.wall);
        if (wasBlocked) {
          canvas.style.cursor = "not-allowed";
          self._cb.onStatus(
            `Blocked by roof slope — header would exceed roof line. ` +
            `Snapped to nearest fit.`
          );
        } else {
          canvas.style.cursor = "grabbing";
        }
        o.leftIn = newLeft;
        self._cb.onOpeningChanged(drag.idx);
        self.render();
      } else {
        const hit = hitOpening(p.wx, p.wy);
        canvas.style.cursor = hit ? "grab" : "default";
      }
    });

    canvas.addEventListener("mousedown", (e) => {
      const p = toWall(e);
      const hit = hitOpening(p.wx, p.wy);
      if (hit) {
        self._dragging = { idx: hit.i, startWx: p.wx, origLeft: hit.o.leftIn };
        canvas.style.cursor = "grabbing";
        self._cb.onSelectOpening(hit.i);
      } else {
        self._cb.onSelectOpening(-1);
      }
    });
    window.addEventListener("mouseup", () => {
      if (self._dragging) {
        self._cb.onOpeningChanged(self._dragging.idx, true);
      }
      self._dragging = null;
    });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function roofBottomAtX(x, wall) {
    const T = wall.studThickIn || 1.5;
    const topN = Math.max(1, wall.topPlates || 2);
    const H = wall.heightIn;
    const tpBottom = H - topN * T;
    if (wall.roofStyle !== "slope") return tpBottom;
    const slopePerIn = Math.max(0, wall.roofPitchIn12 || 0) / 12;
    if (slopePerIn <= 0) return tpBottom;
    const clampedX = clamp(x, 0, wall.lengthIn);
    return wall.roofHighSide === "left"
      ? tpBottom - slopePerIn * clampedX
      : tpBottom - slopePerIn * (wall.lengthIn - clampedX);
  }

  function openingLeftIsValid(left, opening, wall) {
    if (wall.roofStyle !== "slope") return true;
    const T = wall.studThickIn || 1.5;
    const SC = Math.max(0, wall.sideClearance || 0);
    const kingL = left - SC - T * 2;
    const kingR = left + opening.widthIn + SC + T * 2;
    const headerTop = opening.headHeightIn + opening.headerDepthIn;
    const roofMin = Math.min(roofBottomAtX(kingL, wall), roofBottomAtX(kingR, wall));
    return headerTop <= roofMin + 1e-6;
  }

  function findNearestValidOpeningLeft(candidateLeft, opening, wall, fallbackLeft) {
    if (openingLeftIsValid(candidateLeft, opening, wall)) return candidateLeft;

    const maxLeft = wall.lengthIn - opening.widthIn;
    const step = 1 / 16;
    for (let i = 1; i <= 2000; i++) {
      const left = candidateLeft - i * step;
      const right = candidateLeft + i * step;
      const canLeft = left >= 0 && openingLeftIsValid(left, opening, wall);
      const canRight = right <= maxLeft && openingLeftIsValid(right, opening, wall);
      if (canLeft && canRight) {
        return Math.abs(left - fallbackLeft) <= Math.abs(right - fallbackLeft) ? left : right;
      }
      if (canLeft) return left;
      if (canRight) return right;
      if (left < 0 && right > maxLeft) break;
    }

    return fallbackLeft;
  }

  global.WallView = WallView;
})(window);
