/* advisor.js — Engineering sanity checks, code compliance hints, and
 * material pricing / sheathing estimates.
 *
 * All figures are rules-of-thumb derived from typical IRC non-engineered
 * prescriptive values.  They DO NOT replace a licensed designer or local
 * code review — all warnings are advisory.
 */
(function (global) {
  "use strict";

  // Rough prescriptive header span limits for 2-ply 2x headers in
  // interior/exterior non-bearing or light-bearing walls (feet).
  // Values are conservative IRC Table R602.7 style; adjust in real use.
  const HEADER_SPAN_FT = {
    "2-2x4":  3.0,
    "2-2x6":  5.0,
    "2-2x8":  6.5,
    "2-2x10": 8.0,
    "2-2x12": 9.5,
  };

  // IRC R310 egress: 5.7 ft² net clear, 24" min height, 20" min width,
  // sill ≤ 44" AFF.  Ground-floor allowed 5.0 ft².
  const EGRESS = {
    minNetClearFt2: 5.7,
    minHeightIn: 24,
    minWidthIn: 20,
    maxSillIn: 44,
  };

  // Default unit prices (USD) — editable at runtime via Advisor.setPrices.
  // $/lineal-foot unless noted.
  const DEFAULT_PRICES = {
    "2x4": 0.65,
    "2x6": 1.05,
    "2x8": 1.55,
    "2x10": 2.10,
    "2x12": 2.85,
    "1x6": 0.90,
    "1x8": 1.25,
    "sheathing_osb_7_16": 22.00, // per 4x8 sheet
    "sheathing_osb_1_2":  28.00,
    "drywall_1_2_4x8":    14.00,
    "labor_per_lf_wall":  18.00,
  };

  let _prices = { ...DEFAULT_PRICES };

  function setPrices(next) { _prices = { ...DEFAULT_PRICES, ...(next || {}) }; }
  function getPrices() { return { ..._prices }; }

  /** Pick the smallest qualifying header nominal for a rough opening width. */
  function recommendHeader(roughWidthIn) {
    const spanFt = roughWidthIn / 12;
    const order = ["2-2x4","2-2x6","2-2x8","2-2x10","2-2x12"];
    for (const k of order) {
      if (spanFt <= HEADER_SPAN_FT[k]) return { size: k, maxSpanFt: HEADER_SPAN_FT[k] };
    }
    return null;
  }

  /** Infer the actual header nominal used from the header depth in inches. */
  function inferHeaderFromDepth(depthIn) {
    // 2-ply assumption.  Map to nominal by actual depth.
    if (depthIn >= 11.0) return "2-2x12";
    if (depthIn >=  9.0) return "2-2x10";
    if (depthIn >=  7.0) return "2-2x8";
    if (depthIn >=  5.0) return "2-2x6";
    return "2-2x4";
  }

  /** Return advisory warnings for an opening. */
  function checkOpening(op, idx) {
    const notes = [];
    const label = `Opening ${idx + 1}`;
    // Header span check
    const rec = recommendHeader(op.widthIn);
    const actual = inferHeaderFromDepth(op.headerDepthIn || 3.0);
    if (rec) {
      const order = ["2-2x4","2-2x6","2-2x8","2-2x10","2-2x12"];
      if (order.indexOf(actual) < order.indexOf(rec.size)) {
        notes.push(`${label}: header ${actual} may be undersized for a ${(op.widthIn/12).toFixed(2)} ft span. Prescriptive suggestion: ${rec.size} (≤ ${rec.maxSpanFt} ft).`);
      }
    } else {
      notes.push(`${label}: span ${(op.widthIn/12).toFixed(2)} ft exceeds prescriptive 2-ply header tables. Engineered beam required.`);
    }

    // Egress check for windows
    if (op.kind === "window") {
      const netFt2 = (op.widthIn * op.heightIn) / 144;
      const sillAff = op.sillHeightIn ?? ((op.headHeightIn || 0) - op.heightIn);
      if (netFt2 < EGRESS.minNetClearFt2) {
        notes.push(`${label}: window net area ${netFt2.toFixed(2)} ft² < egress minimum ${EGRESS.minNetClearFt2} ft² (IRC R310). Not suitable as a bedroom egress window.`);
      }
      if (op.heightIn < EGRESS.minHeightIn) {
        notes.push(`${label}: window height ${op.heightIn}" < egress minimum ${EGRESS.minHeightIn}".`);
      }
      if (op.widthIn < EGRESS.minWidthIn) {
        notes.push(`${label}: window width ${op.widthIn}" < egress minimum ${EGRESS.minWidthIn}".`);
      }
      if (sillAff > EGRESS.maxSillIn) {
        notes.push(`${label}: sill height ${sillAff}" > egress maximum ${EGRESS.maxSillIn}".`);
      }
    }
    return notes;
  }

  /** Sheathing sheet count (4x8 panels) for one face of a wall. */
  function sheathingSheets(wall) {
    const areaFt2 = (wall.lengthIn * wall.heightIn) / 144;
    const perSheet = 32; // 4 × 8
    const wasteMul = 1.10;
    return Math.ceil((areaFt2 * wasteMul) / perSheet);
  }

  /** Estimate material cost from a framing result. Returns line items + total. */
  function costEstimate(framing, wall) {
    const lines = [];
    let total = 0;

    // Stud-family lumber (by part size mapped to stud/plate/etc nominal)
    const byNominal = new Map();
    for (const row of framing.cutList) {
      const nominal = normalizeNominal(row.size);
      if (!nominal) continue;
      const lf = (row.lengthIn * row.qty) / 12;
      byNominal.set(nominal, (byNominal.get(nominal) || 0) + lf);
    }
    for (const [nominal, lf] of byNominal.entries()) {
      const ppl = _prices[nominal];
      if (ppl == null) continue;
      const cost = lf * ppl;
      lines.push({ label: `${nominal} lumber`, qty: `${lf.toFixed(1)} LF`, unit: `$${ppl.toFixed(2)}/LF`, cost });
      total += cost;
    }

    // Sheathing (1 face — exterior)
    const sheets = sheathingSheets(wall);
    const sheathPrice = _prices["sheathing_osb_7_16"] || 0;
    if (sheathPrice > 0) {
      const cost = sheets * sheathPrice;
      lines.push({ label: "OSB sheathing (ext, 7/16)", qty: `${sheets} sheets`, unit: `$${sheathPrice.toFixed(2)}/ea`, cost });
      total += cost;
    }
    // Drywall (1 face — interior)
    const drywallSheets = sheets; // same coverage estimate
    const dwPrice = _prices["drywall_1_2_4x8"] || 0;
    if (dwPrice > 0) {
      const cost = drywallSheets * dwPrice;
      lines.push({ label: "Drywall (int, 1/2)", qty: `${drywallSheets} sheets`, unit: `$${dwPrice.toFixed(2)}/ea`, cost });
      total += cost;
    }
    // Labor
    const laborPrice = _prices["labor_per_lf_wall"] || 0;
    if (laborPrice > 0) {
      const lf = wall.lengthIn / 12;
      const cost = lf * laborPrice;
      lines.push({ label: "Labor (framing)", qty: `${lf.toFixed(1)} LF wall`, unit: `$${laborPrice.toFixed(2)}/LF`, cost });
      total += cost;
    }
    return { lines, total };
  }

  /** "2x4" -> "2x4"; "2-2x6 Header" -> "2x6" (per-ply LF counted twice). */
  function normalizeNominal(sizeStr) {
    const s = String(sizeStr).toLowerCase();
    // Handle "2-2x6" / "3-2x10" header notation by doubling/tripling LF
    const multi = s.match(/^(\d)-(\d+x\d+)/);
    if (multi) return multi[2]; // per-ply normalization — plies are represented by qty
    const simple = s.match(/\d+x\d+/);
    return simple ? simple[0] : null;
  }

  global.Advisor = {
    checkOpening,
    recommendHeader,
    sheathingSheets,
    costEstimate,
    setPrices,
    getPrices,
    DEFAULT_PRICES,
    EGRESS,
    HEADER_SPAN_FT,
  };
})(window);
