/* corners.js — Detect corner connections between walls in the plan view.
 *
 * At each wall endpoint, figures out whether this wall "contains" the
 * corner (its rect extends past the centerline endpoint to cover the 3-D
 * corner post) or "butts" into a neighbor (its rect is recessed so its
 * end aligns with the face of the neighbor).
 *
 * Rule:
 *   - T-intersection (endpoint lands on another wall's side):
 *     neighbor always contains.  This wall butts.
 *   - L-corner (two endpoints coincide):
 *     the wall with the LOWER array index contains.  The other butts.
 *
 * Corner analysis is done in VISUAL coordinates (using radV = -rotationDeg)
 * so that what the user sees in plan view is what gets analyzed.
 */
(function (global) {
  "use strict";

  const TOL = 0.35; // inches — geometric tolerance

  function wallGeom(w, idx) {
    const rad   = (w.plan.rotationDeg || 0) * Math.PI / 180;
    const radV  = -rad; // visual rotation (matches ctx.rotate(-seg.rad) in plan.js)
    const depth = w.wall.studDepthIn || 3.5;
    const len   = w.wall.lengthIn;
    const sx = w.plan.x, sy = w.plan.y;
    const ex = sx + len * Math.cos(radV);
    const ey = sy + len * Math.sin(radV);
    return { idx, w, depth, len, radV, sx, sy, ex, ey };
  }

  function findConnection(i, pt, infos) {
    // Returns { j, type:'end'|'side' } of the neighbor wall this endpoint
    // connects to.  T-intersections (side crossings) take priority over
    // L-corners.  Among L-corner candidates, prefer the lowest index.
    let bestL = null;
    let bestSide = null;
    const a = infos[i];
    for (let j = 0; j < infos.length; j++) {
      if (j === i) continue;
      const b = infos[j];
      // End-to-end joints can be face-snapped (offset by ~depth/2) rather than
      // centerline-coincident. Treat anything within half-depth reach as an
      // endpoint joint candidate.
      const endReach = Math.max(a.depth, b.depth) / 2 + TOL;
      const dS = Math.hypot(pt.x - b.sx, pt.y - b.sy);
      const dE = Math.hypot(pt.x - b.ex, pt.y - b.ey);
      if (dS <= endReach || dE <= endReach) {
        if (bestL === null || j < bestL) bestL = j;
        continue;
      }
      const dx = b.ex - b.sx, dy = b.ey - b.sy;
      const L2 = dx * dx + dy * dy;
      if (L2 < 1e-6) continue;
      const t = ((pt.x - b.sx) * dx + (pt.y - b.sy) * dy) / L2;
      if (t > 0.02 && t < 0.98) {
        const px = b.sx + t * dx;
        const py = b.sy + t * dy;
        const d  = Math.hypot(pt.x - px, pt.y - py);
        if (d <= b.depth / 2 + TOL) {
          if (bestSide === null || j < bestSide) bestSide = j;
        }
      }
    }
    if (bestSide !== null) return { j: bestSide, type: "side" };
    if (bestL    !== null) return { j: bestL,    type: "end" };
    return null;
  }

  function analyze(state) {
    if (!state || !state.walls) return [];
    const infos = state.walls.map(wallGeom);
    return infos.map((inf, i) => {
      const res = {
        idx: i,
        startContains: false, endContains: false,
        startInset:    0,     endInset:    0,   // positive = recess, negative = extend
        startNeighborIdx: -1, endNeighborIdx: -1,
        startNeighborDepth: 0, endNeighborDepth: 0,
      };
      const cS = findConnection(i, { x: inf.sx, y: inf.sy }, infos);
      if (cS) {
        const nb = infos[cS.j];
        res.startNeighborIdx   = cS.j;
        res.startNeighborDepth = nb.depth;
        if (cS.type === "side" || cS.j < i) {
          res.startInset = nb.depth / 2;        // butt into neighbor
        } else {
          res.startInset    = -nb.depth / 2;    // contain — extend rect past centerline
          res.startContains = true;
        }
      }
      const cE = findConnection(i, { x: inf.ex, y: inf.ey }, infos);
      if (cE) {
        const nb = infos[cE.j];
        res.endNeighborIdx   = cE.j;
        res.endNeighborDepth = nb.depth;
        if (cE.type === "side" || cE.j < i) {
          res.endInset = nb.depth / 2;
        } else {
          res.endInset    = -nb.depth / 2;
          res.endContains = true;
        }
      }
      return res;
    });
  }

  global.Corners = { analyze };
})(typeof window !== "undefined" ? window : globalThis);
