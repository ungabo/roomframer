/* calculator.js — Ft/In arithmetic calculator widget. */
(function (global) {
  "use strict";

  function openCalc() { document.getElementById("modalCalc").classList.remove("hidden"); }
  function closeCalc() { document.getElementById("modalCalc").classList.add("hidden"); }

  function compute() {
    const a = Units.parse(document.getElementById("calcA").value);
    const b = Units.parse(document.getElementById("calcB").value);
    const op = document.getElementById("calcOp").value;
    let r = NaN;
    if (isFinite(a) && isFinite(b)) {
      if (op === "+") r = a + b;
      else if (op === "-") r = a - b;
      else if (op === "*") r = a * (b / 12); // treat B as factor-in-feet? no—use raw multiply
      else if (op === "/") r = b === 0 ? NaN : a / b;
    }
    // For × and ÷ we actually want: a × b (scalar treated as inches is odd).
    // Interpret: × and ÷ use b as a scalar number (just the value in inches / unitless).
    if (op === "*") r = a * b;
    if (op === "/") r = b === 0 ? NaN : a / b;

    document.getElementById("calcResultFtIn").textContent =
      isFinite(r) ? Units.formatFtIn(r) : "—";
    document.getElementById("calcResultIn").textContent =
      isFinite(r) ? Units.formatInches(r) + "  (" + r.toFixed(4) + " in)" : "—";
  }

  function init() {
    document.getElementById("btnCalc").addEventListener("click", openCalc);
    document.querySelectorAll("#modalCalc [data-close]").forEach(el =>
      el.addEventListener("click", closeCalc));
    document.getElementById("modalCalc").addEventListener("click", (e) => {
      if (e.target.id === "modalCalc") closeCalc();
    });
    document.getElementById("calcEq").addEventListener("click", compute);
    ["calcA","calcB","calcOp"].forEach(id => {
      document.getElementById(id).addEventListener("keydown", (e) => {
        if (e.key === "Enter") compute();
      });
    });
  }

  global.Calc = { init, open: openCalc, close: closeCalc };
})(window);
