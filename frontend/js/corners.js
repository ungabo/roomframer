/* corners.js — Detect end-of-wall to face-of-wall connections in plan view.
 *
 * Real wood-framing model implemented here:
 *  - Walls are rectangles that may TOUCH but never overlap.
 *  - The only valid connection is "end of wall A meets a face of wall B".
 *  - When that happens, the wall whose FACE is contacted (the "through wall")
 *    gets one or more extra nailer studs at the contact location:
 *      * Mid-span T: a pair of studs on the through wall straddling the
 *        contact line so the butt wall's end stud nests between them.
 *      * L corner (contact within ~5% of either end of the through wall):
 *        a single nailer stud on the inside of the through wall's end stud.
 *  - The butt wall's end stud is NEVER suppressed.  Both walls keep their
 *    natural framing; only the through wall gains added members.
 *  - Walls are drawn at exactly their entered length.  No wall is extended
 *    past its end to draw the corner — the corner post is *inside* the
 *    through wall's existing end-stud zone.
 *
 * Output per wall index i:
 *   {
 *     idx,
 *     intersectionStudsAt: [t, ...]   // 0..1 along through-wall axis
 *   }
 */
(function (global) {
  "use strict";

  const FACE_TOL = 0.4;     // inches, strict face-contact tolerance
  const PROJ_TOL = 0.08;    // allow slight projection overshoot before clamping

  function wallGeom(w, idx) {
    // plan.js renders with ctx.rotate(-rotationDeg); mirror that here so
    // the analyzer matches what's drawn on screen.
    const radV  = -(w.plan.rotationDeg || 0) * Math.PI / 180;
    const depth = w.wall.studDepthIn || 3.5;
    const len   = w.wall.lengthIn;
    const sx = w.plan.x, sy = w.plan.y;
    const ux = Math.cos(radV), uy = Math.sin(radV);
    const ex = sx + len * ux;
    const ey = sy + len * uy;
    return { idx, w, depth, len, sx, sy, ex, ey };
  }

  function pushUnique(arr, v, tol) {
    if (!arr.some((x) => Math.abs(x - v) <= tol)) arr.push(v);
  }

  function stableWallToken(info) {
    const w = info && info.w ? info.w : {};
    if (w.id !== undefined && w.id !== null) {
      const n = Number(w.id);
      if (Number.isFinite(n)) return { kind: 0, num: n, text: String(w.id) };
      return { kind: 1, num: 0, text: String(w.id) };
    }
    if (w.name) return { kind: 2, num: 0, text: String(w.name) };
    const p = w.plan || {};
    const ww = w.wall || {};
    return {
      kind: 3,
      num: 0,
      text: [p.x || 0, p.y || 0, p.rotationDeg || 0, ww.lengthIn || 0].join("|"),
    };
  }

  function compareWallToken(a, b) {
    if (a.kind !== b.kind) return a.kind - b.kind;
    if (a.kind === 0 && a.num !== b.num) return a.num - b.num;
    if (a.text < b.text) return -1;
    if (a.text > b.text) return 1;
    return 0;
  }

  // Does the point `pt` (an endpoint of another wall) lie on one of `wall`'s
  // long faces (within FACE_TOL)?  Returns { t, faceDelta } if so.
  function endpointFaceHit(pt, wall) {
    const dx = wall.ex - wall.sx;
    const dy = wall.ey - wall.sy;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-6) return null;

    const tRaw = ((pt.x - wall.sx) * dx + (pt.y - wall.sy) * dy) / L2;
    if (tRaw < -PROJ_TOL || tRaw > 1 + PROJ_TOL) return null;
    const t = Math.max(0, Math.min(1, tRaw));
    const projOvershoot = Math.abs(tRaw - t);

    const cx = wall.sx + t * dx;
    const cy = wall.sy + t * dy;
    const L = Math.sqrt(L2);
    const nx = -dy / L;
    const ny = dx / L;
    const signedOff = (pt.x - cx) * nx + (pt.y - cy) * ny;
    const faceDelta = Math.abs(Math.abs(signedOff) - wall.depth / 2);
    if (faceDelta > FACE_TOL) return null;

    return { t, tRaw, faceDelta, projOvershoot };
  }

  function endpointPoint(info, useStart) {
    return useStart
      ? { x: info.sx, y: info.sy }
      : { x: info.ex, y: info.ey };
  }

  function analyze(state) {
    if (!state || !state.walls) return [];
    const infos = state.walls.map(wallGeom);
    const wallTokens = infos.map(stableWallToken);

    // Output keeps legacy fields (startInset/endInset/startBlock/endBlock)
    // pinned at 0 so any older renderer reading them is harmless.  The only
    // live signal is intersectionStudsAt on the through wall.
    const out = infos.map((inf) => ({
      idx: inf.idx,
      startInset: 0, endInset: 0,
      startBlock: 0, endBlock: 0,
      intersectionStudsAt: [],
    }));

    for (let i = 0; i < infos.length; i++) {
      const a = infos[i];
      const endpoints = [
        { x: a.sx, y: a.sy, isStart: true },
        { x: a.ex, y: a.ey, isStart: false },
      ];

      for (const ep of endpoints) {
        let best = null;
        for (let j = 0; j < infos.length; j++) {
          if (j === i) continue;
          const hit = endpointFaceHit(ep, infos[j]);
          if (!hit) continue;
          if (!best || hit.faceDelta < best.hit.faceDelta) best = { j, hit };
        }
        if (!best) continue;
        // L-corner deduplication: when ep's contact lands at the through
        // wall j's own endpoint (t≈0 or t≈1), both walls will detect each
        // other reciprocally. Pick exactly ONE by stable wall identity, not
        // array order, so render output is deterministic across reorderings.
        const tEdge = 0.02;
        const atThroughEnd = best.hit.t < tEdge || best.hit.t > 1 - tEdge;
        if (atThroughEnd) {
          // If the reciprocal endpoint->face match exists, prefer the hit
          // requiring less projection clamping. This captures the actual
          // butt->through relationship in near-end L corners and avoids
          // creation-order/ID-driven ownership flips.
          const throughInfo = infos[best.j];
          const reciprocalPt = endpointPoint(throughInfo, best.hit.t < 0.5);
          const reciprocal = endpointFaceHit(reciprocalPt, a);
          const reciprocalAtEnd = reciprocal && (reciprocal.t < tEdge || reciprocal.t > 1 - tEdge);
          if (reciprocalAtEnd) {
            const eps = 1e-6;
            if (best.hit.projOvershoot > reciprocal.projOvershoot + eps) continue;
            if (Math.abs(best.hit.projOvershoot - reciprocal.projOvershoot) <= eps
              && compareWallToken(wallTokens[best.j], wallTokens[i]) > 0) continue;
          }
        }
        // The wall whose face is contacted (j) gets an intersection stud
        // marker at the contact location.  plan.js / svg_export.js decide
        // whether to draw a mid-span pair or a single corner-inside stud.
        pushUnique(out[best.j].intersectionStudsAt, best.hit.t, 0.02);
      }
    }

    return out;
  }

  global.Corners = { analyze };
})(typeof window !== "undefined" ? window : globalThis);
