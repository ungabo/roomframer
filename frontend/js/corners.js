/* corners.js — Detect end-of-wall to face-of-wall connections in plan view.
 *
 * Real wood-framing model implemented here:
 *  - Walls are rectangles that may TOUCH but never overlap.
 *  - The only valid connection is "end of wall A meets a face of wall B".
 *  - When that happens, the wall whose FACE is contacted (the "through wall")
 *    gets one or more extra nailer studs at the contact location:
 *      * Mid-span T: a perpendicular backer centered on the contact line,
 *        with studs on both sides of it. Existing studs can satisfy either
 *        side if they already land in the required slots.
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
 *     intersectionStudsAt: [{ t, faceSign }, ...]   // 0..1 along through-wall axis
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

  function pushUniqueIntersection(arr, marker, tol) {
    if (!arr.some((x) => Math.abs(x.t - marker.t) <= tol && x.faceSign === marker.faceSign)) {
      arr.push(marker);
    }
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
  // long faces (within FACE_TOL)?  Returns { t, faceDelta, faceSign } if so.
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
    const faceSign = signedOff >= 0 ? 1 : -1;

    return { t, tRaw, faceDelta, projOvershoot, faceSign };
  }

  function endpointPoint(info, useStart) {
    return useStart
      ? { x: info.sx, y: info.sy }
      : { x: info.ex, y: info.ey };
  }

  function overlapsRange(ax, aw, bx, bw, tol) {
    return (ax + aw) > (bx + tol) && ax < (bx + bw - tol);
  }

  function listVerticalMembers(framingMembers) {
    const kinds = new Set(["stud", "king", "jack", "cripple_above", "cripple_below"]);
    return (framingMembers || [])
      .filter((member) => kinds.has(member.kind) && typeof member.x === "number" && typeof member.w === "number")
      .map((member) => ({ x: member.x, w: member.w }))
      .sort((a, b) => a.x - b.x);
  }

  function studOccupiesSlot(studs, x, w) {
    return studs.some((stud) => overlapsRange(x, w, stud.x, stud.w, 0.01));
  }

  function chooseMidLayout(studs, cx, studThickIn, studDepthIn, wallLengthIn) {
    const seen = new Set();
    const candidates = [];

    function addCandidate(perpX) {
      const key = perpX.toFixed(3);
      if (seen.has(key)) return;
      seen.add(key);

      const leftX = perpX - studThickIn;
      const rightX = perpX + studDepthIn;
      if (perpX < -1e-6 || perpX + studDepthIn > wallLengthIn + 1e-6) return;
      if (leftX < -1e-6 || rightX + studThickIn > wallLengthIn + 1e-6) return;
      if (cx < perpX - 0.01 || cx > perpX + studDepthIn + 0.01) return;

      let perpCollisions = 0;
      for (const stud of studs) {
        if (overlapsRange(perpX, studDepthIn, stud.x, stud.w, 0.01)) perpCollisions += 1;
      }

      const leftPresent = studOccupiesSlot(studs, leftX, studThickIn);
      const rightPresent = studOccupiesSlot(studs, rightX, studThickIn);
      candidates.push({
        perpX,
        leftX,
        rightX,
        leftPresent,
        rightPresent,
        addedCount: (leftPresent ? 0 : 1) + (rightPresent ? 0 : 1),
        perpCollisions,
        centerMiss: Math.abs((perpX + studDepthIn / 2) - cx),
      });
    }

    addCandidate(cx - (studDepthIn / 2));
    for (const stud of studs) {
      addCandidate(stud.x + stud.w);
      addCandidate(stud.x - studDepthIn);
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => (
      a.perpCollisions - b.perpCollisions
      || a.addedCount - b.addedCount
      || a.centerMiss - b.centerMiss
      || a.perpX - b.perpX
    ));

    return candidates[0] || null;
  }

  function pushUniqueMember(arr, member) {
    if (!arr.some((x) => x.orientation === member.orientation
      && x.faceSign === member.faceSign
      && Math.abs(x.x - member.x) <= 0.01
      && Math.abs(x.w - member.w) <= 0.01)) {
      arr.push(member);
    }
  }

  function intersectionMembersForWall(wall, cornerInfo, framingMembers) {
    if (!wall || !cornerInfo) return [];
    const markers = cornerInfo.intersectionStudsAt || [];
    const wallLengthIn = wall.lengthIn || 0;
    const studThickIn = wall.studThickIn || 1.5;
    const studDepthIn = wall.studDepthIn || 3.5;
    const cornerZone = (studDepthIn / 2) + 0.5;
    const studs = listVerticalMembers(framingMembers);
    const out = [];

    for (const marker of markers) {
      const tAlong = typeof marker === "number" ? marker : marker.t;
      const faceSign = typeof marker === "number" ? -1 : marker.faceSign;
      const distFromStart = tAlong * wallLengthIn;
      const distFromEnd = (1 - tAlong) * wallLengthIn;

      if (distFromStart < cornerZone) {
        pushUniqueMember(out, { orientation: "perp", x: studThickIn, w: studDepthIn, faceSign });
        pushUniqueMember(out, { orientation: "parallel", x: studThickIn + studDepthIn, w: studThickIn, faceSign });
        continue;
      }
      if (distFromEnd < cornerZone) {
        pushUniqueMember(out, { orientation: "perp", x: wallLengthIn - studThickIn - studDepthIn, w: studDepthIn, faceSign });
        pushUniqueMember(out, { orientation: "parallel", x: wallLengthIn - (2 * studThickIn) - studDepthIn, w: studThickIn, faceSign });
        continue;
      }

      const layout = chooseMidLayout(studs, tAlong * wallLengthIn, studThickIn, studDepthIn, wallLengthIn);
      if (!layout) continue;
      pushUniqueMember(out, { orientation: "perp", x: layout.perpX, w: studDepthIn, faceSign });
      if (!layout.leftPresent) pushUniqueMember(out, { orientation: "parallel", x: layout.leftX, w: studThickIn, faceSign });
      if (!layout.rightPresent) pushUniqueMember(out, { orientation: "parallel", x: layout.rightX, w: studThickIn, faceSign });
    }

    return out.sort((a, b) => a.x - b.x || a.w - b.w);
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
        pushUniqueIntersection(out[best.j].intersectionStudsAt, {
          t: best.hit.t,
          faceSign: best.hit.faceSign,
        }, 0.02);
      }
    }

    return out;
  }

  global.Corners = { analyze, intersectionMembersForWall };
})(typeof window !== "undefined" ? window : globalThis);
