/* plan.js — Overhead plan view canvas.
 *
 * Renders each wall as a thick line at its plan.{x,y,rotationDeg}.
 * Supports drag-to-move with snap-to-inch and snap-to-endpoint of other
 * walls, shift+drag to rotate in 15° increments, and double-click to
 * activate a wall in the elevation view.
 *
 * Coordinates: world units are inches.  Origin is arbitrary; camera pans
 * to fit on open.
 */
(function (global) {
  "use strict";

  const SNAP_IN = 1;          // snap moves to the nearest inch
  const SNAP_ENDPOINT_IN = 6; // snap to another wall's endpoint within 6" of cursor (world)
  const WALL_THICKNESS_IN = 5.5; // visual wall thickness regardless of stud depth
  const OPENING_MARKER_IN = 8;
  const OPENING_DIM_OFFSET_PX = 34;

  const PlanView = {
    canvas: null,
    ctx: null,
    state: null,
    api: null,
    zoom: 0.4,       // px per inch
    camX: 0, camY: 0,
    dragging: null,  // { idx, mode: 'move'|'rotate', startX, startY, origPlan }
    hoverIdx: -1,
    snapDims: true,
    showDims: true,
    showCenterlineDims: true,

    init(canvas, api) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.api = api;
      canvas.addEventListener("mousedown", this.onDown.bind(this));
      canvas.addEventListener("mousemove", this.onMove.bind(this));
      window.addEventListener("mouseup", this.onUp.bind(this));
      canvas.addEventListener("dblclick", this.onDblClick.bind(this));
      canvas.addEventListener("wheel", this.onWheel.bind(this), { passive: false });
      this.resize();
      window.addEventListener("resize", () => this.resize());
    },

    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.max(300, rect.width);
      this.canvas.height = Math.max(300, rect.height);
      this.render();
    },

    show(state) {
      this.state = state;
      this.resize();
      this.fitToWalls();
      this.render();
    },

    setZoom(z) {
      this.zoom = Math.max(0.05, Math.min(3.0, z));
      this.render();
    },

    fitToWalls() {
      if (!this.state) return;
      const segs = this.segments();
      if (!segs.length) { this.camX = 0; this.camY = 0; return; }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const s of segs) {
        minX = Math.min(minX, s.x0, s.x1);
        minY = Math.min(minY, s.y0, s.y1);
        maxX = Math.max(maxX, s.x0, s.x1);
        maxY = Math.max(maxY, s.y0, s.y1);
      }
      const pad = 48;
      const wPx = this.canvas.width - pad * 2;
      const hPx = this.canvas.height - pad * 2;
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const zx = wPx / w, zy = hPx / h;
      this.zoom = Math.max(0.05, Math.min(3.0, Math.min(zx, zy)));
      this.camX = minX - pad / this.zoom;
      this.camY = minY - pad / this.zoom;
      const zoomInput = document.getElementById("rngPlanZoom");
      if (zoomInput) zoomInput.value = String(Math.round(this.zoom * 100));
      const zoomLabel = document.getElementById("planZoomLabel");
      if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + "%";
    },

    segments() {
      if (!this.state || !this.state.walls) return [];
      return this.state.walls.map((w, idx) => {
        const len = w.wall.lengthIn;
        // Visual rad — matches ctx.rotate(-rad) in drawWallSegment so that
        // hit-testing and snap targets align with what's on screen.
        const rad = -(w.plan.rotationDeg || 0) * Math.PI / 180;
        const x0 = w.plan.x, y0 = w.plan.y;
        const x1 = x0 + len * Math.cos(rad);
        const y1 = y0 + len * Math.sin(rad);
        return { idx, w, x0, y0, x1, y1, len, rad };
      });
    },

    openingSpans(wallObj) {
      return (wallObj.openings || [])
        .map((op, idx) => ({
          idx,
          kind: op.kind,
          left: Math.max(0, op.leftIn || 0),
          width: Math.max(0, op.widthIn || 0),
          right: Math.max(0, (op.leftIn || 0) + (op.widthIn || 0)),
          height: Math.max(0, op.heightIn || 0),
          center: Math.max(0, (op.leftIn || 0) + (op.widthIn || 0) / 2),
        }))
        .filter((op) => op.width > 0)
        .sort((a, b) => a.left - b.left);
    },

    anchorWorld(seg, offsetIn, planOverride) {
      const plan = planOverride || seg.w.plan;
      const rad = -(plan.rotationDeg || 0) * Math.PI / 180;
      return {
        x: plan.x + offsetIn * Math.cos(rad),
        y: plan.y + offsetIn * Math.sin(rad),
      };
    },

    snapTargets(excludeIdx) {
      const targets = [];
      for (const seg of this.segments()) {
        if (seg.idx === excludeIdx) continue;
        targets.push({ x: seg.x0, y: seg.y0, kind: "wall-end" });
        targets.push({ x: seg.x1, y: seg.y1, kind: "wall-end" });
        const openings = this.openingSpans(seg.w);
        for (const op of openings) {
          for (const cut of [op.left, op.right]) {
            targets.push({
              x: seg.x0 + cut * Math.cos(seg.rad),
              y: seg.y0 + cut * Math.sin(seg.rad),
              kind: "buck",
            });
          }
        }
      }
      return targets;
    },

    // world <-> screen
    wx(x) { return (x - this.camX) * this.zoom; },
    wy(y) { return (y - this.camY) * this.zoom; },
    sx(px) { return this.camX + px / this.zoom; },
    sy(py) { return this.camY + py / this.zoom; },

    screenPos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    },

    hitTest(worldX, worldY) {
      // Return nearest segment index whose perpendicular distance is within
      // half of the visual wall thickness (in world units).
      const segs = this.segments();
      const halfT = WALL_THICKNESS_IN;
      let best = -1, bestD = halfT;
      for (const s of segs) {
        const d = pointToSegDist(worldX, worldY, s.x0, s.y0, s.x1, s.y1);
        if (d < bestD) { bestD = d; best = s.idx; }
      }
      return best;
    },

    onDown(e) {
      if (!this.state) return;
      const sp = this.screenPos(e);
      const wx = this.sx(sp.x), wy = this.sy(sp.y);
      const idx = this.hitTest(wx, wy);
      if (idx < 0) {
        // Start panning
        this.dragging = { mode: "pan", startX: sp.x, startY: sp.y, camX: this.camX, camY: this.camY };
        return;
      }
      const w = this.state.walls[idx];
      const seg = this.segments()[idx];
      // Rotate: pivot around the wall CENTER (not the clicked endpoint).
      // Move:  track the clicked point so the wall follows the cursor.
      const anchorOffsetIn = e.shiftKey ? seg.len / 2 : 0;
      const anchor = this.anchorWorld(seg, anchorOffsetIn);
      this.dragging = {
        idx,
        mode: e.shiftKey ? "rotate" : "move",
        startWX: wx, startWY: wy,
        origPlan: { ...w.plan },
        anchorOffsetIn,
        origAnchor: anchor,
      };
      this.activeSnap = null;
      this.api.setActive(idx);
    },

    onMove(e) {
      const sp = this.screenPos(e);
      const wx = this.sx(sp.x), wy = this.sy(sp.y);
      if (!this.dragging) {
        this.hoverIdx = this.hitTest(wx, wy);
        this.canvas.style.cursor = this.hoverIdx >= 0 ? "grab" : "default";
        this.render();
        this.renderStatus(wx, wy);
        return;
      }
      if (this.dragging.mode === "pan") {
        this.camX = this.dragging.camX - (sp.x - this.dragging.startX) / this.zoom;
        this.camY = this.dragging.camY - (sp.y - this.dragging.startY) / this.zoom;
        this.render();
        return;
      }
      const w = this.state.walls[this.dragging.idx];
      if (this.dragging.mode === "rotate") {
        const dx = wx - this.dragging.origAnchor.x;
        const dy = wy - this.dragging.origAnchor.y;
        // atan2 returns visual angle; store as negated rotationDeg so the
        // renderer (which uses -rotationDeg visually) points the wall at
        // the cursor.
        let visDeg = Math.atan2(dy, dx) * 180 / Math.PI;
        visDeg = Math.round(visDeg / 15) * 15; // 15° snap
        w.plan.rotationDeg = -visDeg;
        const rad = visDeg * Math.PI / 180; // visual rad
        w.plan.x = this.dragging.origAnchor.x - this.dragging.anchorOffsetIn * Math.cos(rad);
        w.plan.y = this.dragging.origAnchor.y - this.dragging.anchorOffsetIn * Math.sin(rad);
      } else {
        const rad = -(w.plan.rotationDeg || 0) * Math.PI / 180;
        // Free-translate: move the clicked point by the cursor delta
        const dxW = wx - this.dragging.startWX;
        const dyW = wy - this.dragging.startWY;
        let px = this.dragging.origPlan.x + dxW;
        let py = this.dragging.origPlan.y + dyW;

        // Both endpoints in the proposed position
        const len = w.wall.lengthIn;
        const s0 = { x: px,                       y: py,                       endKind: "start" };
        const s1 = { x: px + len * Math.cos(rad), y: py + len * Math.sin(rad), endKind: "end"   };

        // Find the best snap for either endpoint to any neighbor target
        const snap = this.bestEndpointSnap(this.dragging.idx, [s0, s1]);
        this.activeSnap = null;
        if (snap) {
          // Shift wall so the snapped endpoint lands exactly on the target
          px += snap.target.x - snap.endpoint.x;
          py += snap.target.y - snap.endpoint.y;
          this.activeSnap = snap.target;
        } else if (this.snapDims) {
          px = Math.round(px / SNAP_IN) * SNAP_IN;
          py = Math.round(py / SNAP_IN) * SNAP_IN;
        }
        w.plan.x = px;
        w.plan.y = py;
      }
      this.render();
      this.renderStatus(wx, wy);
    },

    onUp() {
      if (this.dragging && this.dragging.mode !== "pan") {
        State.commitWallPlan();
      }
      this.dragging = null;
      this.activeSnap = null;
      this.render();
    },

    onDblClick(e) {
      const sp = this.screenPos(e);
      const wx = this.sx(sp.x), wy = this.sy(sp.y);
      const idx = this.hitTest(wx, wy);
      if (idx >= 0) {
        this.api.setActive(idx);
        this.api.closeAndFocusElevation();
      }
    },

    onWheel(e) {
      e.preventDefault();
      const sp = this.screenPos(e);
      const worldX = this.sx(sp.x), worldY = this.sy(sp.y);
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      this.setZoom(this.zoom * factor);
      // keep cursor's world point stable
      this.camX = worldX - sp.x / this.zoom;
      this.camY = worldY - sp.y / this.zoom;
      const zoomInput = document.getElementById("rngPlanZoom");
      if (zoomInput) zoomInput.value = String(Math.round(this.zoom * 100));
      const zoomLabel = document.getElementById("planZoomLabel");
      if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + "%";
      this.render();
    },

    endpointSnap(movingIdx, proposedX, proposedY) {
      let best = null, bestD = SNAP_ENDPOINT_IN;
      for (const target of this.snapTargets(movingIdx)) {
        const d = Math.hypot(proposedX - target.x, proposedY - target.y);
        if (d < bestD) { bestD = d; best = target; }
      }
      return best;
    },

    // Find the best snap across candidate endpoints while enforcing a
    // physical no-overlap corner model:
    // - L-corner endpoint snaps place butting walls on the neighbor face
    //   (offset by neighbor depth/2), not on the same centerline point.
    // - T-snaps land on the neighbor face rather than its centerline.
    bestEndpointSnap(movingIdx, endpoints) {
      const segs = this.segments();
      const moving = segs.find((s) => s.idx === movingIdx);
      if (!moving) return null;
      const umx = Math.cos(moving.rad), umy = Math.sin(moving.rad);
      let best = null, bestD = SNAP_ENDPOINT_IN;
      // 1) Endpoint-to-endpoint snaps (L-corners)
      for (const s of segs) {
        if (s.idx === movingIdx) continue;
        for (const tp of [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }]) {
          for (const ep of endpoints) {
            let targetX = tp.x;
            let targetY = tp.y;
            // Lower index contains the corner.  Higher index butts into it.
            // For the butting wall, snap to the neighbor face so solids don't overlap.
            if (movingIdx > s.idx) {
              const inset = (s.w.wall.studDepthIn || 3.5) / 2;
              const dir = ep.endKind === "start" ? 1 : -1; // interior direction at that endpoint
              targetX += dir * umx * inset;
              targetY += dir * umy * inset;
            }
            const d = Math.hypot(ep.x - targetX, ep.y - targetY);
            if (d < bestD) {
              bestD = d;
              best = { target: { x: targetX, y: targetY }, endpoint: ep };
            }
          }
        }
      }
      if (best) return best;
      // 2) Endpoint-to-wall-face (T-intersections) — snap to nearest point
      //    along a neighbor's centerline, then shift to the nearest face.
      for (const s of segs) {
        if (s.idx === movingIdx) continue;
        const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
        const L2 = dx*dx + dy*dy; if (L2 < 1e-6) continue;
        const L = Math.sqrt(L2);
        const nx = -dy / L, ny = dx / L;
        const faceOff = (s.w.wall.studDepthIn || 3.5) / 2;
        for (const ep of endpoints) {
          const t = ((ep.x - s.x0) * dx + (ep.y - s.y0) * dy) / L2;
          if (t <= 0.02 || t >= 0.98) continue;
          const cx = s.x0 + t * dx, cy = s.y0 + t * dy;
          const side = (ep.x - cx) * nx + (ep.y - cy) * ny >= 0 ? 1 : -1;
          const tx = cx + nx * faceOff * side;
          const ty = cy + ny * faceOff * side;
          const d = Math.hypot(ep.x - tx, ep.y - ty);
          if (d < bestD) { bestD = d; best = { target: { x: tx, y: ty }, endpoint: ep }; }
        }
      }
      return best;
    },

    autoArrangeRectangle() {
      // Arrange up to 4 walls around a rectangle perimeter.
      // Wall 0: bottom, Wall 1: right, Wall 2: top (reversed), Wall 3: left (reversed).
      const walls = this.state.walls;
      if (!walls.length) return;
      const w0 = walls[0];
      w0.plan = { x: 0, y: 0, rotationDeg: 0 };
      if (walls[1]) walls[1].plan = { x: w0.wall.lengthIn, y: 0, rotationDeg: 90 };
      if (walls[2]) {
        walls[2].plan = {
          x: w0.wall.lengthIn,
          y: (walls[1] ? walls[1].wall.lengthIn : w0.wall.lengthIn * 0.6),
          rotationDeg: 180,
        };
      }
      if (walls[3]) {
        walls[3].plan = {
          x: 0,
          y: (walls[1] ? walls[1].wall.lengthIn : w0.wall.lengthIn * 0.6),
          rotationDeg: 270,
        };
      }
      State.commitWallPlan();
      this.fitToWalls();
      this.render();
    },

    renderStatus(wx, wy) {
      const el = document.getElementById("planStatus");
      if (!el) return;
      const inx = Units.formatShort(wx, this.state.unitsMode);
      const iny = Units.formatShort(wy, this.state.unitsMode);
      el.textContent = `x ${inx}   y ${iny}`;
    },

    render() {
      if (!this.ctx || !this.state) return;
      const ctx = this.ctx, cvs = this.canvas;
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      const segs = this.segments();
      this.cornerInfo = (typeof Corners !== "undefined") ? Corners.analyze(this.state) : [];

      // Draw walls as thick lines
      for (const s of segs) {
        const active = s.idx === this.state.activeWallIdx;
        const hover = s.idx === this.hoverIdx;
        this.drawWallSegment(ctx, s, { active, hover });
      }

      // Snap indicator (shown during drag when an endpoint is snapping)
      if (this.activeSnap) {
        const sx = this.wx(this.activeSnap.x);
        const sy = this.wy(this.activeSnap.y);
        ctx.save();
        ctx.strokeStyle = "#1fb466";
        ctx.fillStyle   = "rgba(31,180,102,0.25)";
        ctx.lineWidth   = 2;
        ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      // Overall bounds dims — when 2+ walls present
      if (this.showDims && segs.length >= 2) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of segs) {
          minX = Math.min(minX, s.x0, s.x1);
          minY = Math.min(minY, s.y0, s.y1);
          maxX = Math.max(maxX, s.x0, s.x1);
          maxY = Math.max(maxY, s.y0, s.y1);
        }
        ctx.strokeStyle = "#888";
        ctx.fillStyle = "#333";
        ctx.lineWidth = 1;
        ctx.font = "11px system-ui, Arial";
        // Bottom overall
        const yb = this.wy(maxY) + 30;
        ctx.beginPath();
        ctx.moveTo(this.wx(minX), yb);
        ctx.lineTo(this.wx(maxX), yb);
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillText(Units.formatShort(maxX - minX, this.state.unitsMode), (this.wx(minX) + this.wx(maxX)) / 2, yb - 4);
        // Right overall
        const xr = this.wx(maxX) + 30;
        ctx.beginPath();
        ctx.moveTo(xr, this.wy(minY));
        ctx.lineTo(xr, this.wy(maxY));
        ctx.stroke();
        ctx.save();
        ctx.translate(xr + 4, (this.wy(minY) + this.wy(maxY)) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.fillText(Units.formatShort(maxY - minY, this.state.unitsMode), 0, 0);
        ctx.restore();
      }
    },

    drawWallSegment(ctx, seg, flags) {
      const active = flags.active;
      const hover  = flags.hover;
      // Use actual stud depth for wall thickness — the standard plan-view section convention.
      const depth       = seg.w.wall.studDepthIn || 3.5;
      const pxThickness = depth * this.zoom;
      const half        = pxThickness / 2;
      const wallLen     = seg.len * this.zoom;
      const wallColor   = active ? "#1f6fb4" : (hover ? "#444" : "#222");
      const openings    = this.openingSpans(seg.w);

      // Corner adjustments: push start/end in or out so L-corners and
      // T-intersections close cleanly.  localStart/localEnd are in world
      // inches measured along the wall axis.
      const c = (this.cornerInfo && this.cornerInfo[seg.idx]) || {
        startInset: 0, endInset: 0,
        startContains: false, endContains: false,
        startNeighborDepth: 0, endNeighborDepth: 0,
      };
      const localStart   = c.startInset;                 // negative → extend past 0
      const localEnd     = seg.len - c.endInset;         // > seg.len when extending
      const pxLocalStart = localStart * this.zoom;
      const pxLocalEnd   = localEnd   * this.zoom;
      const pxRectW      = pxLocalEnd - pxLocalStart;

      ctx.save();
      ctx.translate(this.wx(seg.x0), this.wy(seg.y0));
      ctx.rotate(seg.rad);

      // ── 1. Wall cavity fill (insulation/stud bay area) ───────────────────
      ctx.fillStyle = "#ede8e0";
      ctx.fillRect(pxLocalStart, -half, pxRectW, pxThickness);

      // ── 1b. Corner posts at ends this wall "contains" ────────────────────
      // Fill the extended corner zone with a solid post so the butted
      // neighbor's rect lines up against lumber, not empty cavity.
      const postColor = "#c8845a"; // same as king studs
      if (c.startContains) {
        const w = (c.startNeighborDepth / 2) * this.zoom;
        ctx.fillStyle   = postColor;
        ctx.fillRect(pxLocalStart, -half, w, pxThickness);
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth   = 0.5;
        ctx.strokeRect(pxLocalStart, -half, w, pxThickness);
      }
      if (c.endContains) {
        const w = (c.endNeighborDepth / 2) * this.zoom;
        ctx.fillStyle   = postColor;
        ctx.fillRect(pxLocalEnd - w, -half, w, pxThickness);
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth   = 0.5;
        ctx.strokeRect(pxLocalEnd - w, -half, w, pxThickness);
      }

      // ── 2. Framing members shown in section (professional convention) ────
      // Each stud/king/jack drawn as a filled 1.5"-wide rectangle crossing
      // the full wall depth, exactly as they appear in a panelized shop drawing.
      if (typeof Framing !== "undefined") {
        const fr = Framing.compute({ wall: seg.w.wall, openings: seg.w.openings || [] });
        for (const m of fr.members) {
          if (m.ghost) continue;
          if (!["stud", "king", "jack", "cripple_above", "cripple_below"].includes(m.kind)) continue;
          const px = m.x * this.zoom;
          const pw = (m.w || 1.5) * this.zoom;
          // Skip the end studs on ends that BUTT into a neighbor — the
          // neighbor's corner post is acting as the corner stud there.
          if (c.startInset > 0 && m.x < c.startInset - 0.01) continue;
          if (c.endInset   > 0 && m.x + (m.w || 1.5) > seg.len - c.endInset + 0.01) continue;
          ctx.fillStyle =
            m.kind === "king" ? "#c8845a" :
            m.kind === "jack" ? "#d49060" :
            "#b0a898";                        // stud: warm gray (lumber)
          ctx.fillRect(px, -half, pw, pxThickness);
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(px, -half, pw, pxThickness);
        }
      }

      // ── 3. Openings: clear the RO, draw symbol, jamb lines, annotations ─
      for (const op of openings) {
        const x1 = op.left   * this.zoom;
        const x2 = op.right  * this.zoom;
        const xc = op.center * this.zoom;

        // Clear the rough opening (white = open air)
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x1, -half - 0.5, x2 - x1, pxThickness + 1);

        ctx.setLineDash([]);
        if (op.kind === "door") {
          // Door leaf along near face + quarter-circle swing into the room.
          const swingR = x2 - x1;
          ctx.strokeStyle = "#7d5a3a";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x1, -half);
          ctx.lineTo(x2, -half);          // door leaf closed along near face
          ctx.stroke();
          ctx.strokeStyle = "#7d5a3a";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(x1, -half, swingR, 0, Math.PI / 2, false); // swing arc
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          // Window: two sash lines crossing the opening + glass fill.
          ctx.fillStyle = "rgba(160,210,240,0.25)";
          ctx.fillRect(x1, -half, x2 - x1, pxThickness);
          ctx.strokeStyle = "#2a77c9";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x1, -half / 3); ctx.lineTo(x2, -half / 3);
          ctx.moveTo(x1,  half / 3); ctx.lineTo(x2,  half / 3);
          ctx.stroke();
        }

        // Jamb lines — solid lines at the RO edges crossing the full wall depth
        ctx.strokeStyle = "#333";
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, -half); ctx.lineTo(x1, half);
        ctx.moveTo(x2, -half); ctx.lineTo(x2, half);
        ctx.stroke();

        // C/L dashed centerline + label
        if (this.showCenterlineDims) {
          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = "#777";
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(xc, -half - 14);
          ctx.lineTo(xc, half + OPENING_DIM_OFFSET_PX + 24);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "#555";
          ctx.font = "9px system-ui, Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText("C/L", xc, -half - 6);
        }

        // RO callout (size label) below wall
        ctx.fillStyle = "#333";
        ctx.font = "9px system-ui, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(
          `RO ${Units.formatShort(op.width, this.state.unitsMode)} x ${Units.formatShort(op.height, this.state.unitsMode)}`,
          xc, half + 18
        );
      }

      // ── 4. Wall outline (the two face lines) drawn on top ────────────────
      ctx.setLineDash([]);
      ctx.strokeStyle = wallColor;
      ctx.lineWidth   = active ? 2 : 1.5;
      ctx.strokeRect(pxLocalStart, -half, pxRectW, pxThickness);

      // Endpoint drag handles — small, only on active/hover so studs stay visible
      if (active || hover) {
        ctx.fillStyle = active ? "#1f6fb4" : "#666";
        for (const x of [0, wallLen]) {
          ctx.beginPath();
          ctx.arc(x, 0, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── 5. Labels and dimension chains ───────────────────────────────────
      if (this.showDims) {
        const label = `${seg.w.name}  ${Units.formatShort(seg.len, this.state.unitsMode)}`;
        ctx.fillStyle = "#222";
        ctx.font = "11px system-ui, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(label, wallLen / 2, -half - 4);

        if (seg.w.wall.roofStyle === "slope") {
          const highRight = seg.w.wall.roofHighSide === "right";
          const halfPx = wallLen / 2 - 10;
          const sx1 = highRight ? -halfPx : halfPx;
          const sx2 = -sx1;
          const y = half + 8;
          ctx.strokeStyle = "#c65";
          ctx.fillStyle   = "#c65";
          ctx.lineWidth   = 1.5;
          ctx.beginPath();
          ctx.moveTo(wallLen / 2 + sx1, y);
          ctx.lineTo(wallLen / 2 + sx2, y);
          ctx.stroke();
          const dir  = Math.sign(sx2 - sx1);
          const tipX = wallLen / 2 + sx2;
          ctx.beginPath();
          ctx.moveTo(tipX, y);
          ctx.lineTo(tipX - 6 * dir, y - 3);
          ctx.lineTo(tipX - 6 * dir, y + 3);
          ctx.closePath();
          ctx.fill();
        }

        this.drawOpeningDimensions(ctx, seg, openings, pxThickness);
        if (this.showCenterlineDims) this.drawCenterlineDimensions(ctx, seg, openings, pxThickness);
      }

      ctx.restore();
    },

    drawOpeningDimensions(ctx, seg, openings, pxThickness) {
      if (!openings.length) return;
      const y = pxThickness / 2 + OPENING_DIM_OFFSET_PX;
      const cuts = [0];
      for (const op of openings) {
        cuts.push(op.left, op.right);
      }
      cuts.push(seg.len);

      ctx.strokeStyle = "#666";
      ctx.fillStyle = "#333";
      ctx.lineWidth = 1;
      ctx.font = "10px system-ui, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";

      for (const cut of cuts) {
        const x = cut * this.zoom;
        ctx.beginPath();
        ctx.moveTo(x, pxThickness / 2 + 2);
        ctx.lineTo(x, y + 5);
        ctx.stroke();
      }

      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i];
        const b = cuts[i + 1];
        if (b - a <= 0.01) continue;
        this.drawLocalDim(ctx, a * this.zoom, b * this.zoom, y,
          Units.formatShort(b - a, this.state.unitsMode));
      }
    },

    drawCenterlineDimensions(ctx, seg, openings, pxThickness) {
      if (!openings.length) return;
      const y = pxThickness / 2 + OPENING_DIM_OFFSET_PX + 18;
      const cuts = [0, ...openings.map((op) => op.center), seg.len];
      ctx.strokeStyle = "#5b5b5b";
      ctx.fillStyle = "#2f2f2f";
      ctx.lineWidth = 1;
      ctx.font = "10px system-ui, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";

      for (const cut of cuts) {
        const x = cut * this.zoom;
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x, y + 5);
        ctx.stroke();
      }
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i];
        const b = cuts[i + 1];
        if (b - a <= 0.01) continue;
        this.drawLocalDim(ctx, a * this.zoom, b * this.zoom, y,
          Units.formatShort(b - a, this.state.unitsMode));
      }
    },
  };

  function drawArrowHead(ctx, x, y, dir) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6 * dir, y - 3);
    ctx.lineTo(x + 6 * dir, y + 3);
    ctx.closePath();
    ctx.fill();
  }

  function drawTick(ctx, x, y) {
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
  }

  PlanView.drawLocalDim = function (ctx, x1, x2, y, label) {
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    drawTick(ctx, x1, y);
    drawTick(ctx, x2, y);
    ctx.fillText(label, (x1 + x2) / 2, y - 3);
    ctx.fillStyle = "#666";
    drawArrowHead(ctx, x1, y, 1);
    drawArrowHead(ctx, x2, y, -1);
    ctx.fillStyle = "#333";
  };

  function pointToSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const L2 = dx * dx + dy * dy;
    if (L2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  global.PlanView = PlanView;
})(window);
