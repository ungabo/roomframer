/* units.js — Feet/Inches parsing, formatting, and math.
 *
 * Internal unit: SIXTEENTHS of an inch (integer). 1" = 16, 1' = 192.
 * All geometry in the app uses `inches` (decimal float) in state, but
 * parsing/formatting snaps to 1/16".  (Sufficient for wall framing.)
 */
(function (global) {
  "use strict";

  const IN_PER_FT = 12;
  const UNITS_MODES = { FTIN: "ftin", INCHES: "inches" };

  // --- Parsing ---------------------------------------------------------------
  // Accepts (case-insensitive, flexible whitespace):
  //   8' 6 1/2"        8'6"       8'           8ft 6in     8 ft 6 1/2 in
  //   102              102.5      102 1/2"     102-1/2     8-6  (=> 8ft 6in)
  //   6 1/2            -3' 4"
  // Returns Number (inches), or NaN if not parseable.
  function parseMeasure(raw) {
    if (raw == null) return NaN;
    let s = String(raw).trim();
    if (!s) return NaN;

    // Normalize quotes and words
    s = s.replace(/[\u2018\u2019\u2032]/g, "'")
         .replace(/[\u201C\u201D\u2033]/g, '"')
         .replace(/\bfeet\b|\bfoot\b|\bft\b/gi, "'")
         .replace(/\binches\b|\binch\b|\bin\b/gi, '"')
         .replace(/\s+/g, " ")
         .trim();

    // Leading sign
    let sign = 1;
    if (s.startsWith("-")) { sign = -1; s = s.slice(1).trim(); }
    if (s.startsWith("+")) { s = s.slice(1).trim(); }

    // Architectural shorthand "8-6" (feet-inches). Only when no quotes present.
    if (!/['"]/.test(s) && /^\d+\s*-\s*\d+(?:[ \-]\d+\/\d+)?$/.test(s)) {
      s = s.replace(/^(\d+)\s*-\s*/, '$1\' ').trim() + '"';
    }

    let feet = 0, inches = 0;

    // Feet portion
    const ftMatch = s.match(/^([\-\d.]+)\s*'\s*/);
    if (ftMatch) {
      feet = parseFloat(ftMatch[1]);
      if (isNaN(feet)) return NaN;
      s = s.slice(ftMatch[0].length).trim();
    }

    // Strip trailing quote if present
    s = s.replace(/"$/, "").trim();

    // Inches portion: "6", "6.5", "6 1/2", "1/2"
    if (s.length) {
      inches = parseInchesToken(s);
      if (isNaN(inches)) return NaN;
    }

    return sign * (feet * IN_PER_FT + inches);
  }

  function parseInchesToken(s) {
    s = s.trim();
    if (!s) return 0;
    // "a b/c"
    const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (mixed) {
      const d = parseInt(mixed[3], 10);
      if (!d) return NaN;
      return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / d;
    }
    // "b/c"
    const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (frac) {
      const d = parseInt(frac[2], 10);
      if (!d) return NaN;
      return parseInt(frac[1], 10) / d;
    }
    // decimal
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  // --- Formatting ------------------------------------------------------------
  const FRAC_DEN = 16; // snap display to 1/16"

  function snap16(inches) {
    return Math.round(inches * FRAC_DEN) / FRAC_DEN;
  }

  function fractionString(num, den) {
    // reduce
    const g = gcd(num, den);
    num /= g; den /= g;
    return num + "/" + den;
  }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }

  // Format inches as "8'-6 1/2\"" or plain inches. Negative handled.
  function formatFtIn(inches, opts) {
    const o = opts || {};
    if (!isFinite(inches)) return "—";
    const sign = inches < 0 ? "-" : "";
    let v = Math.abs(inches);
    // Snap to 1/16"
    let sixt = Math.round(v * FRAC_DEN);
    let whole = Math.floor(sixt / FRAC_DEN);
    let num = sixt - whole * FRAC_DEN;
    let feet = Math.floor(whole / IN_PER_FT);
    let inch = whole - feet * IN_PER_FT;

    let inchStr;
    if (num === 0) {
      inchStr = inch + '"';
    } else {
      inchStr = (inch ? inch + " " : "") + fractionString(num, FRAC_DEN) + '"';
    }
    if (feet === 0) {
      // "0' 6 1/2\"" or just "6 1/2\""
      return sign + (o.forceFeet ? "0'-" + inchStr : inchStr);
    }
    // "8'-6 1/2\""
    return sign + feet + "'-" + inchStr;
  }

  function formatInches(inches) {
    if (!isFinite(inches)) return "—";
    const v = snap16(inches);
    // Show decimal if has fraction
    if (Math.abs(v - Math.round(v)) < 1e-9) return v.toFixed(0) + '"';
    return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + '"';
  }

  function format(inches, mode, opts) {
    return mode === UNITS_MODES.INCHES ? formatInches(inches) : formatFtIn(inches, opts);
  }

  // Short variant suitable for small dimension labels (omits zero-inch feet if wanted)
  function formatShort(inches, mode) {
    if (mode === UNITS_MODES.INCHES) return formatInches(inches);
    return formatFtIn(inches);
  }

  // Live-update an <input class="measure">: re-format on blur.
  function wireMeasureInput(input, getMode) {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("blur", () => {
      const v = parseMeasure(input.value);
      if (isFinite(v)) input.value = format(v, getMode());
    });
  }

  global.Units = {
    MODES: UNITS_MODES,
    IN_PER_FT,
    parse: parseMeasure,
    format,
    formatFtIn,
    formatInches,
    formatShort,
    snap16,
    wireMeasureInput,
  };
})(window);
