/* svg_export.js — Export an elevation (or plan view) to downloadable SVG.
 *
 * Generates a vector-perfect drawing matching the current canvas output for
 * the active wall.  Uses the same Framing.compute result so dimensions and
 * members line up.  No external dependencies.
 */
(function (global) {
  "use strict";

  const NS = 'xmlns="http://www.w3.org/2000/svg"';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function exportElevation(state) {
    const s = state;
    const wall = s.wall;
    const framing = Framing.compute({ wall, openings: s.openings });
    const cornerInfo = (typeof global.Corners !== "undefined" && s.walls) ? global.Corners.analyze(s) : [];
    const activeCornerInfo = cornerInfo[s.activeWallIdx] || { intersectionStudsAt: [] };
    const elevationIntersectionMembers = (typeof global.Corners !== "undefined" && typeof global.Corners.intersectionMembersForWall === "function")
      ? buildElevationIntersectionMembers(wall, framing.meta, global.Corners.intersectionMembersForWall(wall, activeCornerInfo, framing.members))
      : [];
    const meta = framing.meta;
    const px = 4; // 4 svg units per inch at export (high fidelity)

    const isSlope = meta.roofStyle === "slope";
    const ovLow  = isSlope ? (meta.roofOverhangLowIn  || 0) : 0;
    const ovHigh = isSlope ? (meta.roofOverhangHighIn || 0) : 0;
    const leftExtra  = (meta.roofHighSide === "left"  ? ovHigh : ovLow) * px;
    const rightExtra = (meta.roofHighSide === "right" ? ovHigh : ovLow) * px;
    const topExtra   = isSlope ? ((wall.roofRafterDepthIn || 5.5) + 6) * px : 0;

    const MARGIN_LEFT = 56, MARGIN_TOP = 60;
    const MARGIN_RIGHT = 140, MARGIN_BOTTOM = 140;
    const Wpx = wall.lengthIn * px;
    const Hpx = wall.heightIn * px;
    const totalW = MARGIN_LEFT + leftExtra + Wpx + rightExtra + MARGIN_RIGHT;
    const totalH = MARGIN_TOP + topExtra + Hpx + MARGIN_BOTTOM;

    const wallLeft = MARGIN_LEFT + leftExtra;
    const wallBot  = MARGIN_TOP + topExtra + Hpx;

    const wallX = (x) => wallLeft + x * px;
    const wallY = (y) => wallBot - y * px;

    const out = [];
    out.push(`<svg ${NS} width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`);
    out.push(`<style>
      text { font-family: system-ui, Arial, sans-serif; font-size: 11px; fill: #222; }
      .title { font-weight: 700; font-size: 14px; }
      .dim { stroke: #333; stroke-width: 0.7; fill: none; }
      .dim-text { font-size: 10px; }
      .member { stroke: #4a4a4a; stroke-width: 0.8; }
      .wall-outline { stroke: #222; stroke-width: 1.4; fill: none; }
      .ghost { opacity: 0.55; }
    </style>`);
    out.push(`<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#fff"/>`);

    // Wall outline
    if (isSlope) {
      const leftTop = wallY(meta.leftWallHeight);
      const rightTop = wallY(meta.rightWallHeight);
      out.push(`<polygon class="wall-outline" points="${wallLeft},${wallBot} ${wallLeft},${leftTop} ${wallLeft + Wpx},${rightTop} ${wallLeft + Wpx},${wallBot}"/>`);
    } else {
      out.push(`<rect class="wall-outline" x="${wallLeft}" y="${wallBot - Hpx}" width="${Wpx}" height="${Hpx}"/>`);
    }

    // Members — separate into inside vs outside wall clip.  SVG can clip
    // via <clipPath>.  Build one for inside.
    const clipId = "wallclip";
    if (isSlope) {
      const leftTop = wallY(meta.leftWallHeight);
      const rightTop = wallY(meta.rightWallHeight);
      out.push(`<clipPath id="${clipId}"><polygon points="${wallLeft},${wallBot} ${wallLeft},${leftTop} ${wallLeft + Wpx},${rightTop} ${wallLeft + Wpx},${wallBot}"/></clipPath>`);
    } else {
      out.push(`<clipPath id="${clipId}"><rect x="${wallLeft}" y="${wallBot - Hpx}" width="${Wpx}" height="${Hpx}"/></clipPath>`);
    }

    const insideKinds = new Set(["bottom_plate","top_plate","top_plate_slope","window_ghost","door_ghost","stud","king","jack","cripple_above","cripple_below","sill","header","rafter_mark"]);
    const outsideKinds = new Set(["rafter","fascia","birdsmouth"]);

    const memberSvg = (m) => {
      const fill = m.color || "#efe7c7";
      const ghost = m.ghost ? " ghost" : "";
      if (m.points) {
        const pts = m.points.map((p) => `${wallX(p.x)},${wallY(p.y)}`).join(" ");
        return `<polygon class="member${ghost}" points="${pts}" fill="${fill}"/>`;
      }
      const x = wallX(m.x);
      const y = wallY(m.y + m.h);
      const w = m.w * px;
      const h = m.h * px;
      return `<rect class="member${ghost}" x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
    };

    // Inside the clip
    out.push(`<g clip-path="url(#${clipId})">`);
    for (const m of framing.members) {
      if (insideKinds.has(m.kind)) out.push(memberSvg(m));
    }
    for (const m of elevationIntersectionMembers) {
      out.push(memberSvg(m));
    }
    out.push(`</g>`);

    // Outside the clip (rafter + fascia + birdsmouths)
    for (const m of framing.members) {
      if (outsideKinds.has(m.kind)) out.push(memberSvg(m));
    }

    // Opening outlines + labels
    for (const g of framing.members.filter((m) => m.ghost && (m.kind === "door_ghost" || m.kind === "window_ghost"))) {
      const x = wallX(g.x);
      const y = wallY(g.y + g.h);
      const w = g.w * px;
      const h = g.h * px;
      const stroke = g.kind === "door_ghost" ? "#555" : "#2a77c9";
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${stroke}" stroke-width="1.6"/>`);
      if (h > 28) {
        out.push(`<text x="${x + w / 2}" y="${y + 14}" text-anchor="middle">${g.kind === "door_ghost" ? "DOOR" : "WINDOW"}</text>`);
        if (h > 48) {
          out.push(`<text x="${x + w / 2}" y="${y + h - 10}" text-anchor="middle">${esc(Units.formatShort(g.w, s.unitsMode))} × ${esc(Units.formatShort(g.h, s.unitsMode))}</text>`);
        }
      }
    }

    // Title & overall dimensions
    out.push(`<text class="title" x="${wallLeft}" y="${MARGIN_TOP - 24}">${esc(s.projectName || "Wall")}</text>`);
    const metaLine = `${wall.studNominal} @ ${Units.formatShort(wall.spacingOC, s.unitsMode)} O.C.  ·  ${Units.formatShort(wall.lengthIn, s.unitsMode)} × ${Units.formatShort(wall.heightIn, s.unitsMode)}`
      + (isSlope ? `  ·  slope ${Units.formatShort(wall.roofPitchIn12, s.unitsMode)} in 12 (${wall.roofHighSide} high)` : "");
    out.push(`<text x="${wallLeft}" y="${MARGIN_TOP - 8}">${esc(metaLine)}</text>`);

    // Overall horizontal dim
    out.push(dimLine(wallLeft, wallLeft + Wpx, wallBot + 80,
      Units.formatShort(wall.lengthIn, s.unitsMode)));
    // Overall vertical dim (right side)
    out.push(dimLineV(wallLeft + Wpx + 40, wallBot - Hpx, wallBot,
      Units.formatShort(wall.heightIn, s.unitsMode)));

    out.push(`</svg>`);
    return out.join("\n");
  }

  function dimLine(x1, x2, y, label) {
    return `<g class="dim">
      <line x1="${x1}" y1="${y - 6}" x2="${x1}" y2="${y + 6}"/>
      <line x1="${x2}" y1="${y - 6}" x2="${x2}" y2="${y + 6}"/>
      <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>
      <text class="dim-text" x="${(x1 + x2) / 2}" y="${y - 3}" text-anchor="middle">${esc(label)}</text>
    </g>`;
  }
  function dimLineV(x, y1, y2, label) {
    return `<g class="dim">
      <line x1="${x - 6}" y1="${y1}" x2="${x + 6}" y2="${y1}"/>
      <line x1="${x - 6}" y1="${y2}" x2="${x + 6}" y2="${y2}"/>
      <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>
      <text class="dim-text" x="${x + 8}" y="${(y1 + y2) / 2}" dominant-baseline="middle">${esc(label)}</text>
    </g>`;
  }

  function exportPlan(state) {
    // Professional plan SVG matching the canvas drawWallSegment convention:
    // walls as true double-line rectangles (actual stud depth), each framing
    // member shown in section as a filled rect, openings with door-swing arc
    // or window glazing, dimension chains below each wall.
    const walls = state.walls;
    const px = 3; // 3 svg units per inch → crisp at letter/tabloid scale
    const showCenterlineDims = !!(global.PlanView && global.PlanView.showCenterlineDims);
    const corners = (typeof global.Corners !== "undefined")
      ? global.Corners.analyze(state)
      : walls.map(() => ({ intersectionStudsAt: [] }));

    // ── Bounding box (walls draw at exactly their entered length) ──
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const segs = walls.map((w, i) => {
      const len   = w.wall.lengthIn;
      const depth = w.wall.studDepthIn || 3.5;
      // plan.js renders with ctx.rotate(-rad) so the visual direction is
      // the NEGATIVE of rotationDeg.  Mirror that here so the SVG matches.
      const rad   = -(w.plan.rotationDeg || 0) * Math.PI / 180;
      const x0 = w.plan.x, y0 = w.plan.y;
      const x1 = x0 + len * Math.cos(rad);
      const y1 = y0 + len * Math.sin(rad);
      const c = corners[i] || { intersectionStudsAt: [] };
      const nx = -Math.sin(rad) * depth / 2;
      const ny =  Math.cos(rad) * depth / 2;
      for (const [cx, cy] of [
        [x0 + nx, y0 + ny], [x0 - nx, y0 - ny],
        [x1 + nx, y1 + ny], [x1 - nx, y1 - ny],
      ]) {
        minX = Math.min(minX, cx); minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx); maxY = Math.max(maxY, cy);
      }
      return { w, x0, y0, x1, y1, len, rad, depth, corner: c, idx: i };
    });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 192; maxY = 192; }

    const pad = 60; // room for labels and dim chains
    const W = (maxX - minX) * px + pad * 2;
    const H = (maxY - minY) * px + pad * 2;
    const tx = (x) => pad + (x - minX) * px;
    const ty = (y) => pad + (y - minY) * px;

    const out = [];
    out.push(`<svg ${NS} width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
    out.push(`<style>
      text { font-family: system-ui, Arial, sans-serif; font-size: 11px; fill: #222; }
      .dim { stroke: #555; stroke-width: 0.8; fill: none; }
      .dim-text { font-size: 9px; fill: #333; }
      .label { font-size: 10px; fill: #333; font-weight: 600; }
      .wall-outline { stroke: #222; stroke-width: 1.5; fill: none; }
      .jamb { stroke: #333; stroke-width: 1.5; fill: none; }
      .swing { stroke: #7d5a3a; stroke-width: 1; fill: none; stroke-dasharray: 3 3; }
      .win-glass { fill: rgba(160,210,240,0.3); stroke: #2a77c9; stroke-width: 0.8; }
    </style>`);
    out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);

    // Title
    out.push(`<text x="${pad}" y="22" style="font-size:13px;font-weight:700">${esc(state.projectName || "Framing Plan")}</text>`);
    out.push(`<text x="${pad}" y="38" style="font-size:10px;fill:#555">Overhead Plan View  ·  Scale: 1:1 (inches)</text>`);

    for (const seg of segs) {
      const depth  = seg.depth;
      const half   = depth / 2;   // in world inches
      const halfPx = half * px;
      const lenPx  = seg.len * px;
      const rotDeg = seg.rad * 180 / Math.PI;
      const sx = tx(seg.x0);
      const sy = ty(seg.y0);
      const c  = seg.corner;
      const pxLocalStart = 0;
      const pxLocalEnd   = seg.len * px;
      const pxRectW      = pxLocalEnd - pxLocalStart;

      const openings = (seg.w.openings || [])
        .map((op) => ({
          kind:   op.kind,
          left:   Math.max(0, op.leftIn   || 0),
          width:  Math.max(0, op.widthIn  || 0),
          right:  Math.max(0, (op.leftIn || 0) + (op.widthIn || 0)),
          height: Math.max(0, op.heightIn || 0),
          center: Math.max(0, (op.leftIn || 0) + (op.widthIn || 0) / 2),
        }))
        .filter((op) => op.width > 0)
        .sort((a, b) => a.left - b.left);

      out.push(`<g transform="translate(${r(sx)} ${r(sy)}) rotate(${r(rotDeg)})">`);

      // ── 1. Wall cavity fill ──────────────────────────────────────────────
      out.push(`<rect x="${r(pxLocalStart)}" y="${r(-halfPx)}" width="${r(pxRectW)}" height="${r(depth * px)}" fill="#ede8e0"/>`);

      // ── 2. Studs in section ──────────────────────────────────────────────
      let framingMembers = [];
      if (typeof Framing !== "undefined") {
        const fr = Framing.compute({ wall: seg.w.wall, openings: seg.w.openings || [] });
        framingMembers = fr.members || [];
        for (const m of fr.members) {
          if (m.ghost) continue;
          if (!["stud","king","jack","cripple_above","cripple_below"].includes(m.kind)) continue;
          const mx   = r(m.x * px);
          const mw   = r((m.w || 1.5) * px);
          const fill = m.kind === "king" ? "#c8845a" : m.kind === "jack" ? "#d49060" : "#b0a898";
          out.push(`<rect x="${mx}" y="${r(-halfPx)}" width="${mw}" height="${r(depth * px)}" fill="${fill}" stroke="rgba(0,0,0,0.2)" stroke-width="0.4"/>`);
        }
      }

      // ── 2b. Intersection stud pairs (where another wall end meets this face) ─
      const studW = (seg.w.wall.studThickIn || 1.5) * px;
      const depthPx = depth * px;
      const intersectionMembers = (typeof Corners !== "undefined" && typeof Corners.intersectionMembersForWall === "function")
        ? Corners.intersectionMembersForWall(seg.w.wall, c, framingMembers)
        : [];
      for (const member of intersectionMembers) {
        const rect = member.orientation === "perp"
          ? {
              x: member.x * px,
              w: member.w * px,
              y: member.faceSign >= 0 ? (halfPx - studW) : -halfPx,
              h: studW,
            }
          : {
              x: member.x * px,
              w: member.w * px,
              y: -halfPx,
              h: depthPx,
            };
        if (rect.x < pxLocalStart - 0.5 || rect.x + rect.w > pxLocalEnd + 0.5) continue;
        out.push(`<rect x="${r(rect.x)}" y="${r(rect.y)}" width="${r(rect.w)}" height="${r(rect.h)}" fill="#c8845a" stroke="rgba(0,0,0,0.2)" stroke-width="0.4"/>`);
      }

      // ── 3. Openings ──────────────────────────────────────────────────────
      for (const op of openings) {
        const x1 = r(op.left   * px);
        const x2 = r(op.right  * px);
        const xc = r(op.center * px);
        const opW = r((op.right - op.left) * px);

        // Clear RO (white)
        out.push(`<rect x="${x1}" y="${r(-halfPx - 0.5)}" width="${opW}" height="${r(depth * px + 1)}" fill="#fff"/>`);

        if (op.kind === "door") {
          // Door leaf along near face
          out.push(`<line x1="${x1}" y1="${r(-halfPx)}" x2="${x2}" y2="${r(-halfPx)}" stroke="#7d5a3a" stroke-width="1"/>`);
          // Swing arc (quarter circle from hinge corner)
          const swingR = r(op.width * px);
          out.push(`<path class="swing" d="M ${x1} ${r(-halfPx)} A ${swingR} ${swingR} 0 0 1 ${r(x1 + op.width * px * Math.cos(Math.PI / 2))} ${r(-halfPx + op.width * px * Math.sin(Math.PI / 2))}"/>`);
        } else {
          // Window glazing
          out.push(`<rect class="win-glass" x="${x1}" y="${r(-halfPx)}" width="${opW}" height="${r(depth * px)}"/>`);
          // Two sash lines
          out.push(`<line stroke="#2a77c9" stroke-width="0.8" x1="${x1}" y1="${r(-halfPx / 3)}" x2="${x2}" y2="${r(-halfPx / 3)}"/>`);
          out.push(`<line stroke="#2a77c9" stroke-width="0.8" x1="${x1}" y1="${r( halfPx / 3)}" x2="${x2}" y2="${r( halfPx / 3)}"/>`);
        }

        // Jamb lines crossing full wall depth
        out.push(`<line class="jamb" x1="${x1}" y1="${r(-halfPx)}" x2="${x1}" y2="${r(halfPx)}"/>`);
        out.push(`<line class="jamb" x1="${x2}" y1="${r(-halfPx)}" x2="${x2}" y2="${r(halfPx)}"/>`);

        // RO size callout below wall
        out.push(`<text x="${xc}" y="${r(halfPx + 20)}" text-anchor="middle" class="dim-text">RO ${esc(Units.formatShort(op.width, state.unitsMode))} x ${esc(Units.formatShort(op.height, state.unitsMode))}</text>`);

        // C/L dashed line + label
        if (showCenterlineDims) {
          out.push(`<line class="dim" x1="${xc}" y1="${r(-halfPx - 14)}" x2="${xc}" y2="${r(halfPx + 48)}" stroke-dasharray="4 3"/>`);
          out.push(`<text x="${xc}" y="${r(-halfPx - 4)}" text-anchor="middle" class="dim-text">C/L</text>`);
        }
      }

      // ── 4. Wall outline on top ────────────────────────────────────────────
      out.push(`<rect class="wall-outline" x="${r(pxLocalStart)}" y="${r(-halfPx)}" width="${r(pxRectW)}" height="${r(depth * px)}"/>`);

      // ── 5. Wall label above near face ────────────────────────────────────
      out.push(`<text class="label" x="${r(lenPx / 2)}" y="${r(-halfPx - 5)}" text-anchor="middle">${esc(seg.w.name)}  ${esc(Units.formatShort(seg.len, state.unitsMode))}</text>`);

      // ── 6. Dimension chains ───────────────────────────────────────────────
      if (openings.length) {
        const cuts = [0, ...openings.flatMap((op) => [op.left, op.right]), seg.len];
        const dimY = r(halfPx + 36);
        for (const cut of cuts) {
          const x = r(cut * px);
          out.push(`<line class="dim" x1="${x}" y1="${r(halfPx + 2)}" x2="${x}" y2="${dimY + 5}"/>`);
        }
        for (let i = 0; i < cuts.length - 1; i++) {
          const a = r(cuts[i] * px), b = r(cuts[i + 1] * px);
          if (cuts[i + 1] - cuts[i] < 0.01) continue;
          out.push(planDimChain(a, b, dimY, esc(Units.formatShort(cuts[i + 1] - cuts[i], state.unitsMode))));
        }

        if (showCenterlineDims) {
          const clCuts = [0, ...openings.map((op) => op.center), seg.len];
          const clY = r(halfPx + 54);
          for (const cut of clCuts) {
            const x = r(cut * px);
            out.push(`<line class="dim" x1="${x}" y1="${clY - 4}" x2="${x}" y2="${clY + 4}"/>`);
          }
          for (let i = 0; i < clCuts.length - 1; i++) {
            const a = r(clCuts[i] * px), b = r(clCuts[i + 1] * px);
            if (clCuts[i + 1] - clCuts[i] < 0.01) continue;
            out.push(planDimChain(a, b, clY, esc(Units.formatShort(clCuts[i + 1] - clCuts[i], state.unitsMode))));
          }
        }
      }

      out.push(`</g>`);
    }

    out.push(`</svg>`);
    return out.join("\n");
  }

  function roofBottomAtMember(meta, x, w) {
    if (meta.roofStyle !== "slope" || !(meta.roofPitchIn12 > 0)) return meta.tpBottom;
    const centerX = Math.max(0, Math.min(meta.W, x + w / 2));
    const slopePerIn = meta.roofPitchIn12 / 12;
    return meta.roofHighSide === "left"
      ? meta.tpBottom - slopePerIn * centerX
      : meta.tpBottom - slopePerIn * (meta.W - centerX);
  }

  function buildElevationIntersectionMembers(wall, meta, layout) {
    const bpTop = meta.bpTop;
    return (layout || []).map((member) => ({
      kind: "intersection_stud",
      x: member.x,
      y: bpTop,
      w: member.w,
      h: Math.max(0, roofBottomAtMember(meta, member.x, member.w) - bpTop),
      color: "#c8845a",
    }));
  }

  function r(v) { return Math.round(v * 100) / 100; }

  function planDimChain(x1, x2, y, label) {
    return [
      `<line class="dim" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>`,
      `<line class="dim" x1="${x1}" y1="${y - 4}" x2="${x1}" y2="${y + 4}"/>`,
      `<line class="dim" x1="${x2}" y1="${y - 4}" x2="${x2}" y2="${y + 4}"/>`,
      `<text class="dim-text" x="${(x1 + x2) / 2}" y="${y - 3}" text-anchor="middle">${label}</text>`,
    ].join("\n");
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  global.SvgExport = { exportElevation, exportPlan, download };
})(window);
