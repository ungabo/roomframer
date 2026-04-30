/* calculator.js — Carpenter's calculator widget. */
(function (global) {
  "use strict";

  function el(id) { return document.getElementById(id); }

  function openCalc() { el("modalCalc").classList.remove("hidden"); }
  function closeCalc() { el("modalCalc").classList.add("hidden"); }

  // ---- Tab navigation -------------------------------------------------------
  function initTabs() {
    document.querySelectorAll(".calc-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".calc-tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".calc-pane").forEach(p => p.classList.add("hidden"));
        btn.classList.add("active");
        el("calcPane-" + btn.dataset.tab).classList.remove("hidden");
      });
    });
  }

  // ---- Arithmetic tab -------------------------------------------------------
  function compute() {
    const a = Units.parse(el("calcA").value);
    const b = Units.parse(el("calcB").value);
    const op = el("calcOp").value;
    let r = NaN;
    if (isFinite(a) && isFinite(b)) {
      if (op === "+") r = a + b;
      else if (op === "-") r = a - b;
      else if (op === "*") r = a * b;
      else if (op === "/") r = b === 0 ? NaN : a / b;
    }
    el("calcResultFtIn").textContent = isFinite(r) ? Units.formatFtIn(r) : "—";
    el("calcResultIn").textContent   = isFinite(r) ? Units.formatInches(r) + "  (" + r.toFixed(4) + " in)" : "—";
  }

  // ---- Convert tab ----------------------------------------------------------
  function initConvert() {
    function parsed() { return Units.parse(el("cvInput").value); }
    function show(main, sub) {
      el("cvResult").textContent  = main;
      el("cvResult2").textContent = sub || "";
    }

    // → Total Inches (decimal)
    el("cvFtToIn").addEventListener("click", () => {
      const v = parsed();
      if (!isFinite(v)) { show("—"); return; }
      show(v.toFixed(4) + '"', Units.formatFtIn(v));
    });
    // → Ft & In
    el("cvInToFt").addEventListener("click", () => {
      const v = parsed();
      if (!isFinite(v)) { show("—"); return; }
      show(Units.formatFtIn(v), v.toFixed(4) + '"');
    });
    // → Decimal Inches
    el("cvToDecIn").addEventListener("click", () => {
      const v = parsed();
      if (!isFinite(v)) { show("—"); return; }
      show(v.toFixed(4) + '"', Units.formatFtIn(v));
    });
    // → Nearest 1/16" fraction
    el("cvToFrac").addEventListener("click", () => {
      const v = parsed();
      if (!isFinite(v)) { show("—"); return; }
      show(Units.formatInches(v), Units.formatFtIn(v));
    });
  }

  // ---- O.C. / Layout tab ----------------------------------------------------
  function initOC() {
    el("ocCalc").addEventListener("click", () => {
      const center = Units.parse(el("ocCenter").value);
      const width  = Units.parse(el("ocWidth").value);
      if (!isFinite(center) || !isFinite(width) || width <= 0) {
        el("ocResult").textContent  = "—";
        el("ocResult2").textContent = "";
        return;
      }
      const leftIn = center - width / 2;
      el("ocResult").textContent  = Units.formatFtIn(leftIn);
      el("ocResult2").textContent = leftIn.toFixed(4) + '"';
    });

    el("layoutCalc").addEventListener("click", () => {
      const wallLen = Units.parse(el("layoutLen").value);
      const spacing = parseFloat(el("layoutSpacing").value);
      const firstIn = Units.parse(el("layoutFirst").value);
      if (!isFinite(wallLen) || wallLen <= 0 || !isFinite(firstIn) || isNaN(spacing)) {
        el("layoutResult").textContent = "—";
        return;
      }
      const positions = [];
      let pos = firstIn;
      while (pos <= wallLen + 0.01) {
        positions.push(pos);
        pos += spacing;
      }
      const lines = positions.map((p, i) => {
        const label = i === 0 ? "King/End" : ("Stud " + i);
        return (label + "        ").slice(0, 10) +
          Units.formatFtIn(p).padStart(11) + "   (" + p.toFixed(4) + '")';
      });
      lines.push("\nTotal studs: " + positions.length);
      el("layoutResult").textContent = lines.join("\n");
    });
  }

  // ---- Rise & Run tab -------------------------------------------------------
  function initRiseRun() {
    el("rrCalc").addEventListener("click", calcRiseRun);
    el("rrClear").addEventListener("click", () => {
      ["rrRise","rrRun","rrPitch"].forEach(id => { el(id).value = ""; });
      ["rrOutRise","rrOutRun","rrOutPitch","rrOutRafter","rrOutAngle"].forEach(id => {
        el(id).textContent = "—";
      });
    });
  }

  function calcRiseRun() {
    let rise  = Units.parse(el("rrRise").value);
    let run   = Units.parse(el("rrRun").value);
    let pitch = parseFloat(el("rrPitch").value); // in/12

    const hasRise  = isFinite(rise);
    const hasRun   = isFinite(run);
    const hasPitch = isFinite(pitch);
    const count = (hasRise ? 1 : 0) + (hasRun ? 1 : 0) + (hasPitch ? 1 : 0);
    if (count < 2) { alert("Enter at least two values."); return; }

    if (!hasRise)  rise  = run * pitch / 12;
    if (!hasRun)   run   = (pitch !== 0) ? rise * 12 / pitch : NaN;
    if (!hasPitch) pitch = (run   !== 0) ? (rise / run) * 12 : NaN;

    const rafter = isFinite(rise) && isFinite(run) ? Math.sqrt(rise * rise + run * run) : NaN;
    const angle  = isFinite(rise) && isFinite(run) ? Math.atan2(rise, run) * 180 / Math.PI : NaN;

    function fmt(v) { return isFinite(v) ? Units.formatFtIn(v) + "  (" + v.toFixed(4) + '"' + ")" : "—"; }
    el("rrOutRise").textContent   = fmt(rise);
    el("rrOutRun").textContent    = fmt(run);
    el("rrOutPitch").textContent  = isFinite(pitch) ? pitch.toFixed(3) + " in/12  (" + pitch.toFixed(2) + ":12)" : "—";
    el("rrOutRafter").textContent = fmt(rafter);
    el("rrOutAngle").textContent  = isFinite(angle) ? angle.toFixed(2) + "°" : "—";

    // fill back the field that was left blank
    if (!hasRise  && isFinite(rise))  el("rrRise").value  = Units.formatFtIn(rise);
    if (!hasRun   && isFinite(run))   el("rrRun").value   = Units.formatFtIn(run);
    if (!hasPitch && isFinite(pitch)) el("rrPitch").value = pitch.toFixed(3);
  }

  // ---- Board Feet tab -------------------------------------------------------
  function initBoardFeet() {
    el("bfCalc").addEventListener("click", () => {
      const thick = parseFloat(el("bfThick").value);
      const width = parseFloat(el("bfWidth").value);
      const lenIn = Units.parse(el("bfLen").value);
      const qty   = Math.max(1, parseInt(el("bfQty").value, 10) || 1);
      if (!isFinite(thick) || !isFinite(width) || !isFinite(lenIn) ||
          thick <= 0 || width <= 0 || lenIn <= 0) {
        el("bfResult").textContent  = "—";
        el("bfResult2").textContent = "";
        return;
      }
      const bfEach  = (thick * width * lenIn) / 144;
      const bfTotal = bfEach * qty;
      el("bfResult").textContent  = bfTotal.toFixed(3) + " BF";
      el("bfResult2").textContent = qty > 1
        ? bfEach.toFixed(3) + " BF each × " + qty + " = " + bfTotal.toFixed(3) + " BF total"
        : "";
    });
  }

  // ---- Init -----------------------------------------------------------------
  function init() {
    el("btnCalc").addEventListener("click", openCalc);
    document.querySelectorAll("#modalCalc [data-close]").forEach(btn =>
      btn.addEventListener("click", closeCalc));
    el("modalCalc").addEventListener("click", (e) => {
      if (e.target.id === "modalCalc") closeCalc();
    });
    el("calcEq").addEventListener("click", compute);
    ["calcA","calcB","calcOp"].forEach(id => {
      el(id).addEventListener("keydown", (e) => { if (e.key === "Enter") compute(); });
    });
    initTabs();
    initConvert();
    initOC();
    initRiseRun();
    initBoardFeet();
  }

  global.Calc = { init, open: openCalc, close: closeCalc };
})(window);
