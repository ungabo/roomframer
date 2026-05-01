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

  function normalizedWallName(wall) {
    return String((wall && wall.name) || "").toLowerCase();
  }

  function wallNameHints(wall) {
    const name = normalizedWallName(wall);
    return {
      front: /\b(front|street|road|entry|main)\b/.test(name),
      back: /\b(back|rear|alley)\b/.test(name),
      left: /\bleft\b|\bside\s*a\b|\ba\s*side\b/.test(name),
      right: /\bright\b|\bside\s*b\b|\bb\s*side\b/.test(name),
      side: /\bside\b/.test(name),
      street: /\b(street|road)\b/.test(name),
    };
  }

  function permutations(arr) {
    const out = [];
    const used = new Array(arr.length).fill(false);
    const path = [];
    function rec() {
      if (path.length === arr.length) {
        out.push(path.slice());
        return;
      }
      for (let i = 0; i < arr.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        path.push(arr[i]);
        rec();
        path.pop();
        used[i] = false;
      }
    }
    rec();
    return out;
  }

  function chooseRectWallOrder(walls) {
    const n = Math.min(4, walls.length);
    const ids = Array.from({ length: n }, (_, i) => i);
    if (!ids.length) return [];
    if (ids.length === 1) return ids;

    const lengths = walls.slice(0, n).map((w) => Number(w.wall.lengthIn) || 0);
    const sortedByLen = ids.slice().sort((a, b) => lengths[a] - lengths[b]);
    const lenRank = new Map(sortedByLen.map((idx, rank) => [idx, rank]));
    const hints = new Map(ids.map((i) => [i, wallNameHints(walls[i])]));
    const slots = ["front", "right", "back", "left"].slice(0, n);

    function scoreForSlot(idx, slot) {
      const h = hints.get(idx);
      let s = 0;
      if (slot === "front") {
        if (h.front) s += 24;
        if (h.street) s += 12;
        if (h.back) s -= 20;
      }
      if (slot === "back") {
        if (h.back) s += 24;
        if (h.front || h.street) s -= 20;
      }
      if (slot === "left") {
        if (h.left) s += 24;
        if (h.right) s -= 16;
        if (h.side && !h.left && !h.right) s += 8;
      }
      if (slot === "right") {
        if (h.right) s += 24;
        if (h.left) s -= 16;
        if (h.side && !h.left && !h.right) s += 8;
      }

      if (n === 4) {
        const rank = lenRank.get(idx) || 0; // 0 shortest .. 3 longest
        if (slot === "front" || slot === "back") s += rank * 3;
        if (slot === "left" || slot === "right") s += (3 - rank) * 3;
      }

      return s;
    }

    let best = null;
    for (const p of permutations(ids)) {
      let score = 0;
      for (let i = 0; i < slots.length; i++) score += scoreForSlot(p[i], slots[i]);
      // Tie-breaker for deterministic output.
      for (let i = 0; i < p.length; i++) score -= p[i] * (0.001 * (i + 1));
      if (!best || score > best.score) best = { perm: p.slice(), score };
    }
    return best ? best.perm : ids;
  }

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
      this.zoom = Math.max(0.05, Math.min(20.0, z));
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
      this.zoom = Math.max(0.05, Math.min(20.0, Math.min(zx, zy)));
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
        lastValidPlan: { ...w.plan },
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
        const rad = visDeg * Math.PI / 180; // visual rad
        const proposed = {
          x: this.dragging.origAnchor.x - this.dragging.anchorOffsetIn * Math.cos(rad),
          y: this.dragging.origAnchor.y - this.dragging.anchorOffsetIn * Math.sin(rad),
          rotationDeg: -visDeg,
        };
        if (!this.overlapsAnyWall(this.dragging.idx, proposed)) {
          w.plan.x = proposed.x;
          w.plan.y = proposed.y;
          w.plan.rotationDeg = proposed.rotationDeg;
          this.dragging.lastValidPlan = { ...proposed };
        } else {
          w.plan.x = this.dragging.lastValidPlan.x;
          w.plan.y = this.dragging.lastValidPlan.y;
          w.plan.rotationDeg = this.dragging.lastValidPlan.rotationDeg;
        }
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
        const proposed = { x: px, y: py, rotationDeg: w.plan.rotationDeg || 0 };
        if (!this.overlapsAnyWall(this.dragging.idx, proposed)) {
          w.plan.x = proposed.x;
          w.plan.y = proposed.y;
          this.dragging.lastValidPlan = { ...proposed };
        } else {
          w.plan.x = this.dragging.lastValidPlan.x;
          w.plan.y = this.dragging.lastValidPlan.y;
          this.activeSnap = null;
        }
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
      // Set zoom directly (skip setZoom to avoid a premature render before camX/camY are updated)
      this.zoom = Math.max(0.05, Math.min(20.0, this.zoom * factor));
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

    // Snap a dragged wall endpoint to a face of any neighbor wall.
    //
    // Real wood-framing rule: the only valid connection is "end of moving
    // wall touches a face of another wall".  This is true regardless of
    // whether the contact lands mid-span (T-intersection) or right at the
    // through wall's own end (L-corner).  The snap formula is the same in
    // both cases — the butt wall's end-centerline lands on the through
    // wall's face at the projected, clamped contact point.  At a corner
    // that means the butt wall caps off the through wall's outer end
    // (extending past it by `movingHalf`), which is how a standard
    // platform-framed L-corner is built.
    //
    // Snap targets are rejected if they would force overlap with any
    // other wall (touching is fine, penetration is not).
    bestEndpointSnap(movingIdx, endpoints) {
      const segs = this.segments();
      let best = null, bestD = SNAP_ENDPOINT_IN;
      const moving = this.state && this.state.walls ? this.state.walls[movingIdx] : null;
      const startEp = endpoints.find((ep) => ep.endKind === "start") || endpoints[0];
      const rotDeg = moving && moving.plan ? (moving.plan.rotationDeg || 0) : 0;

      // Moving wall's face-normal (for computing its own end-king corners).
      const mRad = -rotDeg * Math.PI / 180;
      const mUx = Math.cos(mRad), mUy = Math.sin(mRad);
      const mNx = -mUy, mNy = mUx;
      const mHalf = (moving && moving.wall ? (moving.wall.studDepthIn || 3.5) : 3.5) / 2;

      const tryCandidate = (ep, tx, ty) => {
        const d = Math.hypot(ep.x - tx, ep.y - ty);
        if (d >= bestD) return;
        const dx = tx - ep.x;
        const dy = ty - ep.y;
        const proposed = {
          x: startEp.x + dx,
          y: startEp.y + dy,
          rotationDeg: rotDeg,
        };
        if (this.overlapsAnyWall(movingIdx, proposed)) return;
        bestD = d;
        best = { target: { x: tx, y: ty }, endpoint: ep };
      };

      for (const s of segs) {
        if (s.idx === movingIdx) continue;
        const sDepth = s.w.wall.studDepthIn || 3.5;
        const sThick = s.w.wall.studThickIn || 1.5;
        const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
        const L = Math.sqrt(dx*dx + dy*dy); if (L < 1e-6) continue;
        const sNx = -dy / L, sNy = dx / L;
        const sHalf = sDepth / 2;

        // ── Corner-to-corner snap (L-corners from any orientation) ──────────
        // Neighbor's 4 end-king outer corners in world space.
        const nCorners = [
          { x: s.x0 + sNx * sHalf, y: s.y0 + sNy * sHalf },  // start, face+
          { x: s.x0 - sNx * sHalf, y: s.y0 - sNy * sHalf },  // start, face-
          { x: s.x1 + sNx * sHalf, y: s.y1 + sNy * sHalf },  // end,   face+
          { x: s.x1 - sNx * sHalf, y: s.y1 - sNy * sHalf },  // end,   face-
        ];

        for (const ep of endpoints) {
          // Moving wall's 2 outer corners for this endpoint.
          const mCorners = [
            { x: ep.x + mNx * mHalf, y: ep.y + mNy * mHalf },   // face+
            { x: ep.x - mNx * mHalf, y: ep.y - mNy * mHalf },   // face-
          ];
          for (const mc of mCorners) {
            const offX = mc.x - ep.x, offY = mc.y - ep.y;
            for (const nc of nCorners) {
              // Translate the moving wall so mc lands on nc.
              tryCandidate(ep, nc.x - offX, nc.y - offY);
            }
          }
        }

        // ── Face-projection snap (mid-span T only) ───────────────────────────
        // Only fires when the contact is far enough from either end that no
        // corner-to-corner alignment applies there.
        for (const ep of endpoints) {
          const tRaw = ((ep.x - s.x0) * dx + (ep.y - s.y0) * dy) / (L * L);
          if (tRaw < -0.08 || tRaw > 1.08) continue;
          const t = Math.max(0, Math.min(1, tRaw));
          const distFromStart = t * s.len;
          const distFromEnd   = (1 - t) * s.len;
          if (distFromStart < mHalf + sThick || distFromEnd < mHalf + sThick) continue;
          const cx = s.x0 + t * dx, cy = s.y0 + t * dy;
          for (const sign of [1, -1]) {
            tryCandidate(ep, cx + sNx * sHalf * sign, cy + sNy * sHalf * sign);
          }
        }
      }
      return best;
    },

    wallRectFromPlan(wallObj, plan) {
      const len = wallObj.wall.lengthIn || 0;
      const depth = wallObj.wall.studDepthIn || 3.5;
      const rad = -(plan.rotationDeg || 0) * Math.PI / 180;
      const ux = Math.cos(rad), uy = Math.sin(rad);
      const nx = -uy, ny = ux;
      const half = depth / 2;
      const x0 = plan.x, y0 = plan.y;
      const x1 = x0 + len * ux, y1 = y0 + len * uy;
      return [
        { x: x0 + nx * half, y: y0 + ny * half },
        { x: x0 - nx * half, y: y0 - ny * half },
        { x: x1 - nx * half, y: y1 - ny * half },
        { x: x1 + nx * half, y: y1 + ny * half },
      ];
    },

    overlapsAnyWall(movingIdx, proposedPlan) {
      if (!this.state || !this.state.walls || movingIdx < 0 || movingIdx >= this.state.walls.length) return false;
      const moving = this.state.walls[movingIdx];
      const a = this.wallRectFromPlan(moving, proposedPlan);
      for (let i = 0; i < this.state.walls.length; i++) {
        if (i === movingIdx) continue;
        const b = this.wallRectFromPlan(this.state.walls[i], this.state.walls[i].plan);
        // Allow touching (shared edge/point). Only block real penetration.
        // Small positive epsilon absorbs floating-point drift at snap positions.
        if (polygonsOverlapArea(a, b, 0.05)) return true;
      }
      return false;
    },

    autoArrangeRectangle() {
      // Arrange walls around a rectangle using wall names + length heuristics.
      // Slots: front (bottom), right, back (top reversed), left (reversed).
      const walls = this.state.walls;
      if (!walls.length) return;
      const order = chooseRectWallOrder(walls);
      const frontIdx = order[0];
      const rightIdx = order[1];
      const backIdx = order[2];
      const leftIdx = order[3];

      const frontLen = frontIdx != null ? (walls[frontIdx].wall.lengthIn || 0) : 0;
      const rightLen = rightIdx != null
        ? (walls[rightIdx].wall.lengthIn || 0)
        : Math.max(1, Math.round(frontLen * 0.6));

      if (frontIdx != null) walls[frontIdx].plan = { x: 0, y: 0, rotationDeg: 0 };
      if (rightIdx != null) walls[rightIdx].plan = { x: frontLen, y: 0, rotationDeg: 90 };
      if (backIdx != null) {
        walls[backIdx].plan = {
          x: frontLen,
          y: rightLen,
          rotationDeg: 180,
        };
      }
      if (leftIdx != null) {
        walls[leftIdx].plan = {
          x: 0,
          y: rightLen,
          rotationDeg: 270,
        };
      }

      // If more than 4 walls exist, keep extras near the rectangle center as a best guess.
      for (let i = 4; i < order.length; i++) {
        const idx = order[i];
        const ring = i - 3;
        walls[idx].plan = {
          x: frontLen / 2 + ring * 12,
          y: rightLen / 2 + ring * 12,
          rotationDeg: (i % 2) ? 0 : 90,
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
      this.structureCenter = this.computeStructureCenter(segs);

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

    computeStructureCenter(segs) {
      if (!segs || !segs.length) return { x: 0, y: 0 };
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const seg of segs) {
        sx += seg.x0 + seg.x1;
        sy += seg.y0 + seg.y1;
        n += 2;
      }
      return { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
    },

    exteriorSignForSegment(seg) {
      const c = this.structureCenter || { x: 0, y: 0 };
      const mx = (seg.x0 + seg.x1) / 2;
      const my = (seg.y0 + seg.y1) / 2;
      const nx = -Math.sin(seg.rad);
      const ny = Math.cos(seg.rad);
      const vx = mx - c.x;
      const vy = my - c.y;
      const dot = nx * vx + ny * vy;
      return dot >= 0 ? 1 : -1;
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
      const outsideSign = this.exteriorSignForSegment(seg);

      // Real-construction model: a wall is drawn at exactly its entered
      // length, end-to-end.  No wall extends past its own end.  When another
      // wall butts into this wall's face, the contact location is recorded
      // in `intersectionStudsAt`; we draw an extra nailer stud (or a pair
      // for mid-span T) inside *this* wall's existing stud zone.  No corner-
      // post extension box is drawn — the corner post is always inside the
      // wall, between its end stud and the next stud over.
      const c = (this.cornerInfo && this.cornerInfo[seg.idx]) || {
        intersectionStudsAt: [],
      };
      const pxLocalStart = 0;
      const pxLocalEnd   = wallLen;
      const pxRectW      = pxLocalEnd - pxLocalStart;

      ctx.save();
      ctx.translate(this.wx(seg.x0), this.wy(seg.y0));
      ctx.rotate(seg.rad);

      // ── 1. Wall cavity fill ──────────────────────────────────────────────
      ctx.fillStyle = "#ede8e0";
      ctx.fillRect(pxLocalStart, -half, pxRectW, pxThickness);

      // ── 2. Framing members in section ────────────────────────────────────
      let framingMembers = [];
      if (typeof Framing !== "undefined") {
        const fr = Framing.compute({ wall: seg.w.wall, openings: seg.w.openings || [] });
        framingMembers = fr.members || [];
        for (const m of fr.members) {
          if (m.ghost) continue;
          if (!["stud", "king", "jack", "cripple_above", "cripple_below"].includes(m.kind)) continue;
          const px = m.x * this.zoom;
          const pw = (m.w || 1.5) * this.zoom;
          ctx.fillStyle =
            m.kind === "king" ? "#c8845a" :
            m.kind === "jack" ? "#d49060" :
            "#b0a898";
          ctx.fillRect(px, -half, pw, pxThickness);
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(px, -half, pw, pxThickness);
        }
      }

      // ── 2b. Intersection stud pairs where another wall butts into this one ─
      // Mid-span T intersections use a pair straddling the contact line.
      // L-corner intersections use a perpendicular corner member next to the
      // end king plus one additional inside stud.
      const T = (seg.w.wall.studThickIn || 1.5) * this.zoom;
      const depthPx = depth * this.zoom;
      const intersectionMembers = (typeof Corners !== "undefined" && typeof Corners.intersectionMembersForWall === "function")
        ? Corners.intersectionMembersForWall(seg.w.wall, c, framingMembers)
        : [];
      for (const member of intersectionMembers) {
        const rect = member.orientation === "perp"
          ? {
              x: member.x * this.zoom,
              w: member.w * this.zoom,
              y: member.faceSign >= 0 ? (half - T) : -half,
              h: T,
            }
          : {
              x: member.x * this.zoom,
              w: member.w * this.zoom,
              y: -half,
              h: depthPx,
            };
        for (const r of [rect]) {
          if (r.x < pxLocalStart - 0.5 || r.x + r.w > pxLocalEnd + 0.5) continue;
          ctx.fillStyle = "#c8845a";
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(r.x, r.y, r.w, r.h);
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
        } else if (op.kind === "buck") {
          // Buck: plain open rough frame — diagonal X to indicate unfinished opening
          ctx.strokeStyle = "rgba(180,100,0,0.45)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x1, -half); ctx.lineTo(x2, half);
          ctx.moveTo(x2, -half); ctx.lineTo(x1, half);
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
          const clDimY = outsideSign * (half + OPENING_DIM_OFFSET_PX + 24);
          const clTopY = Math.min(-half - 14, clDimY);
          const clBotY = Math.max(half + 14, clDimY);
          ctx.beginPath();
          ctx.moveTo(xc, -half - 14);
          ctx.lineTo(xc, clTopY);
          ctx.moveTo(xc, clTopY);
          ctx.lineTo(xc, clBotY);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "#555";
          ctx.font = "9px system-ui, Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = outsideSign > 0 ? "top" : "bottom";
          ctx.fillText("C/L", xc, outsideSign > 0 ? (half + 8) : (-half - 8));
        }

        // RO callout (size label) below wall
        ctx.fillStyle = "#333";
        ctx.font = "9px system-ui, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = outsideSign > 0 ? "top" : "bottom";
        ctx.fillText(
          `RO ${Units.formatShort(op.width, this.state.unitsMode)} x ${Units.formatShort(op.height, this.state.unitsMode)}`,
          xc, outsideSign * (half + 18)
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

        this.drawOpeningDimensions(ctx, seg, openings, pxThickness, outsideSign);
        if (this.showCenterlineDims) this.drawCenterlineDimensions(ctx, seg, openings, pxThickness, outsideSign);
      }

      ctx.restore();
    },

    drawOpeningDimensions(ctx, seg, openings, pxThickness, outsideSign) {
      if (!openings.length) return;
      const side = outsideSign >= 0 ? 1 : -1;
      const y = side * (pxThickness / 2 + OPENING_DIM_OFFSET_PX);
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
        const extFrom = side * (pxThickness / 2 + 2);
        const extTo = y + side * 5;
        ctx.beginPath();
        ctx.moveTo(x, extFrom);
        ctx.lineTo(x, extTo);
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

    drawCenterlineDimensions(ctx, seg, openings, pxThickness, outsideSign) {
      if (!openings.length) return;
      const side = outsideSign >= 0 ? 1 : -1;
      const y = side * (pxThickness / 2 + OPENING_DIM_OFFSET_PX + 18);
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
        ctx.moveTo(x, y - side * 5);
        ctx.lineTo(x, y + side * 5);
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
    const side = y >= 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    drawTick(ctx, x1, y);
    drawTick(ctx, x2, y);
    ctx.fillText(label, (x1 + x2) / 2, y - side * 3);
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

  function polygonsOverlapArea(polyA, polyB, eps) {
    const axes = [];
    collectAxes(polyA, axes);
    collectAxes(polyB, axes);
    for (const axis of axes) {
      const a = projectPoly(polyA, axis);
      const b = projectPoly(polyB, axis);
      // Treat edge-touching as non-overlap; only positive area overlap is blocked.
      if (a.max <= b.min + eps || b.max <= a.min + eps) return false;
    }
    return true;
  }

  function collectAxes(poly, out) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const len = Math.hypot(ex, ey);
      if (len < 1e-9) continue;
      out.push({ x: -ey / len, y: ex / len });
    }
  }

  function projectPoly(poly, axis) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of poly) {
      const v = p.x * axis.x + p.y * axis.y;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  }

  global.PlanView = PlanView;
})(window);
