/* framing.js — Deterministic wall framing engine.
 *
 * Supports flat walls and simple single-slope walls.
 */
(function (global) {
  "use strict";

  const COLOR = {
    plate:          "#f5b961",
    stud:           "#f5d36b",
    king:           "#f08a4b",
    jack:           "#f06a4b",
    header:         "#b98cff",
    sill:           "#a1d2ff",
    cripple_above:  "#9bd18f",
    cripple_below:  "#78bf8c",
    opening_door:   "#ffffff",
    opening_window: "#e6f4ff",
    rafter:         "#c98755",
    birdsmouth:     "#7a4a22",
    fascia:         "#ad6a3d",
  };

  function compute(input) {
    const W = Math.max(0, input.wall.lengthIn);
    const H = Math.max(0, input.wall.heightIn);
    const T = input.wall.studThickIn || 1.5;
    const D = input.wall.studDepthIn || 3.5;
    const OC = input.wall.spacingOC || 16;
    const topN = Math.max(1, input.wall.topPlates || 2);
    const botN = Math.max(1, input.wall.bottomPlates || 1);
    const SC = Math.max(0, input.wall.sideClearance || 0);
    const roofStyle = input.wall.roofStyle || "flat";
    const roofPitchIn12 = Math.max(0, input.wall.roofPitchIn12 || 0);
    const roofHighSide = input.wall.roofHighSide || "right";
    const slopePerIn = roofStyle === "slope" ? roofPitchIn12 / 12 : 0;

    const bpTop = botN * T;
    const tpBottom = H - topN * T;
    const baseStudLen = Math.max(0, tpBottom - bpTop);
    const roofBottomAt = (x) => {
      if (roofStyle !== "slope" || slopePerIn <= 0) return tpBottom;
      const clampedX = clamp(x, 0, W);
      return roofHighSide === "left"
        ? tpBottom - slopePerIn * clampedX
        : tpBottom - slopePerIn * (W - clampedX);
    };
    const roofBottomAtMember = (x, w) => roofBottomAt(x + w / 2);
    const roofBottomMinBetween = (x1, x2) => Math.min(roofBottomAt(x1), roofBottomAt(x2));
    const leftRoofBottom = roofBottomAt(0);
    const rightRoofBottom = roofBottomAt(W);
    const leftWallHeight = leftRoofBottom + topN * T;
    const rightWallHeight = rightRoofBottom + topN * T;

    const members = [];
    const warnings = [];
    const openingZones = [];

    if (roofStyle === "slope" && roofBottomMinBetween(0, W) <= bpTop + 1e-6) {
      warnings.push("Roof slope is too steep for the current wall height and length.");
    }

    const openings = (input.openings || []).slice()
      .map((o, i) => ({ ...o, id: o.id || ("op" + (i + 1)) }))
      .sort((a, b) => a.leftIn - b.leftIn);

    members.push({ kind: "bottom_plate", x: 0, y: 0, w: W, h: bpTop, color: COLOR.plate });
    if (roofStyle === "slope" && slopePerIn > 0) {
      members.push({
        kind: "top_plate_slope",
        color: COLOR.plate,
        points: [
          { x: 0, y: leftRoofBottom },
          { x: W, y: rightRoofBottom },
          { x: W, y: rightRoofBottom + topN * T },
          { x: 0, y: leftRoofBottom + topN * T },
        ],
      });
    } else {
      members.push({ kind: "top_plate", x: 0, y: tpBottom, w: W, h: topN * T, color: COLOR.plate });
    }

    members.push({ kind: "king", x: 0, y: bpTop, w: T, h: Math.max(0, roofBottomAtMember(0, T) - bpTop), color: COLOR.king });
    members.push({ kind: "king", x: W - T, y: bpTop, w: T, h: Math.max(0, roofBottomAtMember(W - T, T) - bpTop), color: COLOR.king });

    let prevRightZone = T;
    for (let i = 0; i < openings.length; i++) {
      const op = openings[i];
      const ro_l = op.leftIn;
      const ro_r = op.leftIn + op.widthIn;
      const clearL = ro_l - SC;
      const clearR = ro_r + SC;
      const jackL_x = clearL - T;
      const kingL_x = jackL_x - T;
      const jackR_x = clearR;
      const kingR_x = jackR_x + T;

      if (kingL_x < T) warnings.push(`Opening ${i + 1}: too close to left end (need ≥ ${(T * 2 + SC).toFixed(3)}").`);
      if (kingR_x + T > W - T) warnings.push(`Opening ${i + 1}: too close to right end.`);
      if (kingL_x < prevRightZone) warnings.push(`Opening ${i + 1}: overlaps previous opening's framing.`);

      const headerBot = op.headHeightIn;
      const headerTop = headerBot + op.headerDepthIn;
      if (headerTop > roofBottomMinBetween(kingL_x, kingR_x + T) + 1e-6) {
        warnings.push(`Opening ${i + 1}: header extends into top plate(s).`);
      }
      if (op.kind === "window") {
        const sillTop = op.sillHeightIn;
        const sillBot = sillTop - T;
        if (sillBot < bpTop - 1e-6) warnings.push(`Opening ${i + 1}: sill is below the bottom plate.`);
        if (sillTop + op.heightIn > headerBot + 1e-6) warnings.push(`Opening ${i + 1}: RO height + sill height does not match head height.`);
      } else if (op.heightIn > headerBot + 1e-6) {
        warnings.push(`Opening ${i + 1}: RO height exceeds head height.`);
      }

      members.push({ kind: "king", x: kingL_x, y: bpTop, w: T, h: Math.max(0, roofBottomAtMember(kingL_x, T) - bpTop), color: COLOR.king, oid: op.id });
      members.push({ kind: "king", x: kingR_x, y: bpTop, w: T, h: Math.max(0, roofBottomAtMember(kingR_x, T) - bpTop), color: COLOR.king, oid: op.id });

      const jackH = Math.max(0, headerBot - bpTop);
      members.push({ kind: "jack", x: jackL_x, y: bpTop, w: T, h: jackH, color: COLOR.jack, oid: op.id });
      members.push({ kind: "jack", x: jackR_x, y: bpTop, w: T, h: jackH, color: COLOR.jack, oid: op.id });

      const hdrX = kingL_x + T;
      const hdrW = kingR_x - hdrX;
      members.push({ kind: "header", x: hdrX, y: headerBot, w: hdrW, h: op.headerDepthIn, color: COLOR.header, oid: op.id });

      if (op.kind === "window") {
        const sillTop = op.sillHeightIn;
        const sillBot = sillTop - T;
        members.push({ kind: "sill", x: hdrX, y: sillBot, w: hdrW, h: T, color: COLOR.sill, oid: op.id });
      }

      const openingBot = op.kind === "window" ? op.sillHeightIn : bpTop;
      const openingH = headerBot - openingBot;
      members.push({
        kind: op.kind === "window" ? "window_ghost" : "door_ghost",
        x: ro_l,
        y: openingBot,
        w: op.widthIn,
        h: openingH,
        color: op.kind === "window" ? COLOR.opening_window : COLOR.opening_door,
        oid: op.id,
        ghost: true,
      });

      openingZones.push({
        op,
        kingL_x,
        kingR_x,
        headerTop,
        sillBot: op.kind === "window" ? op.sillHeightIn - T : null,
      });
      prevRightZone = kingR_x + T;
    }

    const isInsideKingZone = (x) => openingZones.some((z) => (x + T) > z.kingL_x + 1e-6 && x < z.kingR_x + T - 1e-6);

    let x = OC - T / 2;
    while (x < W - T) {
      if (x <= T + 1e-6 || x + T >= W - T - 1e-6) {
        x += OC;
        continue;
      }
      const collidesOpening = isInsideKingZone(x);
      if (!collidesOpening) {
        members.push({ kind: "stud", x, y: bpTop, w: T, h: Math.max(0, roofBottomAtMember(x, T) - bpTop), color: COLOR.stud });
      } else {
        const z = openingZones.find((zz) => (x + T) > zz.kingL_x + 1e-6 && x < zz.kingR_x + T - 1e-6);
        if (z) {
          const caY = z.headerTop;
          const caH = roofBottomAtMember(x, T) - caY;
          if (caH > 1e-6) {
            members.push({ kind: "cripple_above", x, y: caY, w: T, h: caH, color: COLOR.cripple_above, oid: z.op.id });
          }
          if (z.sillBot != null) {
            const cbH = z.sillBot - bpTop;
            if (cbH > 1e-6) {
              members.push({ kind: "cripple_below", x, y: bpTop, w: T, h: cbH, color: COLOR.cripple_below, oid: z.op.id });
            }
          }
        }
      }
      x += OC;
    }

    if (roofStyle === "slope" && slopePerIn > 0) {
      // Rafter geometry (representative profile on this elevation).
      const rDepth   = Math.max(0.5, input.wall.roofRafterDepthIn || 5.5);
      const rThick   = Math.max(0.5, input.wall.roofRafterThickIn || 1.5);
      const ovLow    = Math.max(0, input.wall.roofOverhangLowIn  || 0);
      const ovHigh   = Math.max(0, input.wall.roofOverhangHighIn || 0);
      const fDepth   = Math.max(0.25, input.wall.roofFasciaDepthIn || 5.5);
      const fThick   = Math.max(0.25, input.wall.roofFasciaThickIn || 0.75);
      const rafterNominal = input.wall.roofRafterNominal || "2x6";
      const fasciaNominal = input.wall.roofFasciaNominal || "1x6";

      // Top-of-wall line (top of top plate) extended by overhangs.
      // roofHighSide tells us which end is high.  Overhangs are signed by side.
      const highSide = roofHighSide;        // "left" | "right"
      const lowX  = highSide === "left" ? W : 0;
      const highX = highSide === "left" ? 0 : W;
      const xLowEnd  = highSide === "left" ? W + ovLow  : 0 - ovLow;   // eave
      const xHighEnd = highSide === "left" ? 0 - ovHigh : W + ovHigh;  // ridge

      const topOfWallAt = (x) => roofBottomAt(clamp(x, 0, W)) + topN * T;
      const extendedTopAt = (x) => {
        // Project the slope past the wall ends along the same line.
        const y0 = topOfWallAt(0);
        const yW = topOfWallAt(W);
        const m  = (yW - y0) / W;              // rise per inch along x
        return y0 + m * x;
      };
      const rafterTopAt    = (x) => extendedTopAt(x);
      const rafterBottomAt = (x) => extendedTopAt(x) - rDepth;

      // Rafter profile polygon: long sloped plank sitting above top plate,
      // with birdsmouth notch carved at each wall-end bearing.
      // The notch shape at a bearing point (plate inside corner):
      //   seat cut (horizontal) along top plate top, heel cut (vertical).
      const seatIn = Math.min(D, ovLow > 0 ? D : Math.max(1.5, D));   // seat ≈ stud depth
      const rafterMembers = buildRafterProfile({
        xLowEnd, xHighEnd, lowX, highX,
        rafterTopAt, rafterBottomAt,
        topOfWallAt, seatIn,
      });
      rafterMembers.rafter.rafterNominal = rafterNominal;
      members.push(rafterMembers.rafter);
      rafterMembers.birdsmouths.forEach((b) => members.push(b));

      // Fascia board at the eave, plumb, attached to the rafter tail.
      const fasciaTop = rafterTopAt(xLowEnd);
      const fasciaBot = Math.max(bpTop - fDepth, rafterTopAt(xLowEnd) - fDepth - 2);
      const fasciaX = highSide === "left" ? xLowEnd - fThick : xLowEnd;
      members.push({
        kind: "fascia",
        x: fasciaX,
        y: fasciaBot,
        w: fThick,
        h: fasciaTop - fasciaBot,
        color: COLOR.fascia,
        fasciaNominal,
      });

      // Rafter layout marks — where each perpendicular rafter sits (at OC).
      let rx = OC - T / 2;
      while (rx < W - T) {
        members.push({
          kind: "rafter_mark",
          x: rx,
          y: roofBottomAtMember(rx, T),
          w: T,
          h: topN * T,
          color: "#d39f5555",
        });
        rx += OC;
      }

      // Cut list extras: rafter true length and fascia length.
      const rafterHoriz = Math.abs(xHighEnd - xLowEnd);
      const rafterRise  = Math.abs(rafterTopAt(xHighEnd) - rafterTopAt(xLowEnd));
      const rafterLen   = Math.sqrt(rafterHoriz * rafterHoriz + rafterRise * rafterRise);
      const rafterQty   = Math.max(2, Math.floor(W / OC) + 1);
      // Store for cut list build below
      rafterMembers.rafter.trueLengthIn = rafterLen;
      rafterMembers.rafter.qty = rafterQty;
      rafterMembers.rafter.nominal = rafterNominal;

      const fasciaLen = rafterHoriz; // same as wall + overhangs
      members.push({
        kind: "_fascia_meta",
        w: fasciaLen,
        nominal: fasciaNominal,
        ghost: true,
        hidden: true,
      });
    }

    const wallArea = (W * (leftWallHeight + rightWallHeight) / 2) / 144;
    let openingArea = 0;
    openings.forEach((o) => { openingArea += (o.widthIn * o.heightIn) / 144; });

    const studSizeLabel = input.wall.studNominal || studSizeFromDims(T, D);
    const counts = new Map();
    const add = (part, lengthIn, size, qty) => {
      const key = `${part}|${size}|${snap(lengthIn)}`;
      counts.set(key, (counts.get(key) || 0) + (qty || 1));
    };

    members.forEach((m) => {
      if (m.ghost) return;
      switch (m.kind) {
        case "stud":
        case "king":
          add("Stud", m.h, studSizeLabel); break;
        case "jack":
          add("Jack (Trimmer)", m.h, studSizeLabel); break;
        case "cripple_above":
        case "cripple_below":
          add("Cripple", m.h, studSizeLabel); break;
        case "header":
          add("Header", m.w, `${studSizeLabel} (depth ${Units.formatShort(m.h, "ftin")})`); break;
        case "sill":
          add("Window Sill", m.w, studSizeLabel); break;
        case "rafter":
          add("Rafter", m.trueLengthIn || 0, m.rafterNominal || studSizeLabel, m.qty || 1);
          break;
        case "fascia":
          // fascia length captured by _fascia_meta below
          break;
      }
    });
    // Fascia length comes from hidden meta member.
    const fasciaMeta = members.find((m) => m.kind === "_fascia_meta");
    if (fasciaMeta) {
      add("Fascia", fasciaMeta.w, fasciaMeta.nominal || "1x6", 1);
    }

    const rise = Math.abs(rightRoofBottom - leftRoofBottom);
    const topPlateLength = roofStyle === "slope" && rise > 0 ? Math.sqrt(W * W + rise * rise) : W;
    add("Bottom Plate", W, studSizeLabel, botN);
    add("Top Plate", topPlateLength, studSizeLabel, topN);

    const cutList = [];
    counts.forEach((qty, key) => {
      const [part, size, len] = key.split("|");
      cutList.push({ part, size, lengthIn: parseFloat(len), qty });
    });
    cutList.sort((a, b) => a.part.localeCompare(b.part) || (b.lengthIn - a.lengthIn));

    const studCount = members.filter((m) => m.kind === "stud" || m.kind === "king" || m.kind === "jack").length;
    const summary = {
      studCount,
      wallArea: round2(wallArea),
      openingArea: round2(openingArea),
      netArea: round2(wallArea - openingArea),
      openings: openings.length,
      headerCount: openings.length,
      studLen: baseStudLen,
      highWallHeight: round2(Math.max(leftWallHeight, rightWallHeight)),
      lowWallHeight: round2(Math.min(leftWallHeight, rightWallHeight)),
      roofPitchIn12: round2(roofPitchIn12),
    };

    return {
      members: members.filter((m) => !m.hidden),
      warnings,
      summary,
      cutList,
      meta: {
        bpTop,
        tpBottom,
        studLen: baseStudLen,
        T,
        W,
        H,
        roofStyle,
        roofPitchIn12,
        roofHighSide,
        leftRoofBottom,
        rightRoofBottom,
        leftWallHeight,
        rightWallHeight,
        roofOverhangLowIn:  Math.max(0, input.wall.roofOverhangLowIn  || 0),
        roofOverhangHighIn: Math.max(0, input.wall.roofOverhangHighIn || 0),
      },
    };
  }

  function studSizeFromDims(t, d) {
    const nd = Math.round((d + 0.5));
    const nt = Math.round((t + 0.5));
    return `${nt}x${nd}`;
  }

  // Build a rafter profile polygon with birdsmouth notches at each bearing.
  // Inputs are in wall-local coordinates (x along wall, y up from floor).
  //
  // Geometry model:
  //  - Rafter is a sloped plank of depth rDepth above the top plate, extended
  //    horizontally past each end of the wall by overhangs.
  //  - At each bearing (where the wall's top plate supports a perpendicular
  //    rafter), we carve a birdsmouth: heel (plumb) cut down to plate top +
  //    seat (horizontal) cut along plate top for the width of the top plate.
  //  - Outer face of plate is the wall edge (x = 0 or x = W).  Inner face of
  //    plate is D inches into the wall.
  function buildRafterProfile(ctx) {
    const { xLowEnd, xHighEnd, lowX, highX, rafterTopAt, rafterBottomAt, topOfWallAt, seatIn } = ctx;
    const leftToRight = xLowEnd < xHighEnd;
    const D = seatIn;

    // Returns [outerX, innerX] for a bearing at bx.
    //   outerX = the wall edge   (x = 0 or x = W)
    //   innerX = D inches toward the interior from the wall edge.
    const faces = (bx) => {
      // If bx is the low bearing, interior is toward highX.
      const towardInterior = (bx === lowX)
        ? Math.sign(highX - bx)
        : Math.sign(lowX - bx);
      return { outerX: bx, innerX: bx + towardInterior * D };
    };

    // CCW traversal of the outer contour.
    // Start at top of low-end, go across the top to high-end, down the plumb
    // cut, along the bottom from high-end back to low-end (with notches at
    // each bearing), up the plumb cut at the low-end.
    const pts = [];
    pts.push({ x: xLowEnd,  y: rafterTopAt(xLowEnd) });
    pts.push({ x: xHighEnd, y: rafterTopAt(xHighEnd) });
    pts.push({ x: xHighEnd, y: rafterBottomAt(xHighEnd) });

    // Helper to add a birdsmouth notch when we encounter a bearing while
    // walking the bottom edge.  `approachX` is where we enter the notch
    // (the "outer" face relative to travel direction).
    const addNotch = (bx, travelDir) => {
      const f = faces(bx);
      // Along travel from high→low, we first meet the FAR face of the plate
      // (the face that is on the high side).  That's the inner face if bx is
      // the high bearing, and the inner face if bx is the low bearing only
      // when travel direction matches.  Easier: compute both faces and sort
      // by direction of travel.
      const xA = f.outerX;
      const xB = f.innerX;
      const first  = travelDir > 0 ? Math.min(xA, xB) : Math.max(xA, xB);
      const second = travelDir > 0 ? Math.max(xA, xB) : Math.min(xA, xB);
      const plateY = topOfWallAt(bx);
      // approach rafter bottom → heel down → seat across → heel up → continue
      pts.push({ x: first,  y: rafterBottomAt(first) });
      pts.push({ x: first,  y: plateY });
      pts.push({ x: second, y: plateY });
      pts.push({ x: second, y: rafterBottomAt(second) });
    };

    // Walk bottom edge from high end toward low end.
    // Travel direction sign: if leftToRight, we go -x; else we go +x.
    const travelDir = leftToRight ? -1 : +1;
    const bearingsInOrder = leftToRight
      ? [highX, lowX].sort((a, b) => b - a)   // descending x
      : [highX, lowX].sort((a, b) => a - b);  // ascending x

    for (const bx of bearingsInOrder) {
      addNotch(bx, travelDir);
    }

    pts.push({ x: xLowEnd, y: rafterBottomAt(xLowEnd) });

    const rafter = {
      kind: "rafter",
      color: COLOR.rafter,
      points: pts,
    };

    const birdsmouths = bearingsInOrder.map((bx) => {
      const f = faces(bx);
      const xA = Math.min(f.outerX, f.innerX);
      const xB = Math.max(f.outerX, f.innerX);
      const plateY = topOfWallAt(bx);
      return {
        kind: "birdsmouth",
        color: COLOR.birdsmouth,
        points: [
          { x: xA, y: rafterBottomAt(xA) },
          { x: xA, y: plateY },
          { x: xB, y: plateY },
          { x: xB, y: rafterBottomAt(xB) },
        ],
        ghost: true,
      };
    });

    return { rafter, birdsmouths };
  }
  function round2(v) { return Math.round(v * 100) / 100; }
  function snap(v) { return Math.round(v * 16) / 16; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  global.Framing = { compute, COLOR };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
