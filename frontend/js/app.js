/* app.js — UI wiring, boot. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let framingPresets = [];
  let openingPresets = [];
  let currentUser = null;

  // -------------------- Boot --------------------
  window.addEventListener("DOMContentLoaded", async () => {
    try {
      currentUser = await API.getSession();
    } catch (e) {
      window.location.href = "/login";
      return;
    }
    updateAuthUI();

    Calc.init();

    WallView.init({
      canvas: $("wallCanvas"),
      getState: () => State.get(),
      onSelectOpening: (idx) => {
        State.selectOpening(idx);
      },
      onOpeningChanged: (idx, commitHistory) => {
        if (commitHistory) State.commit();
        refreshInspector();
        refreshSummary();
      },
      onStatus: (txt) => { $("statusLine").textContent = txt; },
    });

    State.onChange(() => {
      updateProjectNameUI();
      updateUnitsModeUI();
      syncWallInputsFromState();
      populateWallTabs();
      populatePlanWallList();
      refreshInspector();
      refreshSummary();
      WallView.render();
      if (!$("modalPlan").classList.contains("hidden")) PlanView.render();
    });

    bindToolbar();
    bindWallInputs();
    bindViewToggles();
    bindInspector();
    bindKeyboard();
    bindCollapsibles();
    bindPricesModal();

    try {
      framingPresets = await API.listFramingPresets();
      openingPresets = await API.listOpeningPresets();
    } catch (e) { console.warn("preset load failed", e); }

    populatePresetSelects();
    applyDefaultFramingPresetToActiveWall();

    // Initial render
    State.replace(State.get());
    WallView.render();
    refreshSummary();
    populateWallTabs();

    // Plan view init
    PlanView.init($("planCanvas"), {
      setActive: (idx) => State.setActiveWall(idx),
      closeAndFocusElevation: () => $("modalPlan").classList.add("hidden"),
    });
    bindPlanView();
  });

  // -------------------- UI bindings --------------------
  function bindToolbar() {
    $("btnNew").onclick = () => {
      if (confirm("Start a new wall? Unsaved changes will be lost.")) {
        State.reset();
        applyDefaultFramingPresetToActiveWall();
      }
    };
    $("btnSave").onclick = saveProject;
    $("btnSaveAs").onclick = async () => {
      const currentName = State.get().projectName || "Untitled Project";
      const nextName = await openSaveAsModal(currentName);
      if (!nextName || !nextName.trim()) return;
      State.set({ projectName: nextName.trim() });
      State.get().projectId = null; // force create
      await saveProject(true);
    };
    $("btnOpen").onclick = openProjectsModal;
    $("btnLogout").onclick = async () => {
      try {
        await API.logout();
      } finally {
        window.location.href = "/login";
      }
    };
    $("btnUndo").onclick = () => State.undo();
    $("btnRedo").onclick = () => State.redo();
    $("btnPrint").onclick = doPrint;
    $("btnExportSvg").onclick = () => {
      const s = State.get();
      const svg = SvgExport.exportElevation(s);
      const safeName = (s.projectName || "wall").replace(/[^a-z0-9-_]+/gi, "_");
      const wallName = (s.walls[s.activeWallIdx].name || "elevation").replace(/[^a-z0-9-_]+/gi, "_");
      SvgExport.download(`${safeName}_${wallName}.svg`, svg);
    };

    // Wall tabs
    $("btnAddWall").onclick = () => {
      State.addWall();
      applyDefaultFramingPresetToActiveWall();
    };
    $("btnDupWall").onclick = () => State.duplicateActiveWall();
    $("btnDelWall").onclick = () => {
      const s = State.get();
      if (s.walls.length <= 1) { alert("You must have at least one wall."); return; }
      const w = s.walls[s.activeWallIdx];
      if (confirm(`Delete "${w.name}"? This cannot be undone via Ctrl-Z once you save.`)) {
        State.removeWall(s.activeWallIdx);
      }
    };
    $("btnShowPlan").onclick = openPlanView;

    $("selUnits").onchange = () => {
      State.set({ unitsMode: $("selUnits").value });
    };

    document.querySelectorAll("#modalOpen [data-close]").forEach(el =>
      el.addEventListener("click", () => $("modalOpen").classList.add("hidden")));
    $("modalOpen").addEventListener("click", (e) => {
      if (e.target.id === "modalOpen") $("modalOpen").classList.add("hidden");
    });
    document.querySelectorAll("#modalSaveAs [data-close]").forEach(el =>
      el.addEventListener("click", () => closeSaveAsModal(null)));
    $("modalSaveAs").addEventListener("click", (e) => {
      if (e.target.id === "modalSaveAs") closeSaveAsModal(null);
    });
    $("btnSaveAsConfirm").addEventListener("click", () => {
      closeSaveAsModal($("saveAsName").value);
    });
    $("saveAsName").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        closeSaveAsModal($("saveAsName").value);
      }
    });

    $("btnAddDoor").onclick = () => addDefaultOpening("door");
    $("btnAddWindow").onclick = () => addDefaultOpening("window");
    $("btnAddFromPreset").onclick = addFromOpeningPreset;

    $("projectName").addEventListener("blur", () => {
      State.get().projectName = ($("projectName").textContent || "").trim() || "Untitled Wall";
    });
  }

  function bindWallInputs() {
    const s = () => State.get();
    const measureIds = ["wLength","wHeight","roofPitch","sideClearance","roofOvLow","roofOvHigh"];
    measureIds.forEach(id => Units.wireMeasureInput($(id), () => s().unitsMode));

    $("wLength").addEventListener("change", () => {
      const v = Units.parse($("wLength").value); if (!isFinite(v) || v <= 0) return;
      State.commit(); s().wall.lengthIn = v; WallView.render(); refreshSummary();
    });
    $("wHeight").addEventListener("change", () => {
      const v = Units.parse($("wHeight").value); if (!isFinite(v) || v <= 0) return;
      State.commit(); s().wall.heightIn = v; WallView.render(); refreshSummary();
    });
    $("sideClearance").addEventListener("change", () => {
      const v = Units.parse($("sideClearance").value); if (!isFinite(v) || v < 0) return;
      State.commit(); s().wall.sideClearance = v; WallView.render(); refreshSummary();
    });
    $("roofPitch").addEventListener("change", () => {
      const v = Units.parse($("roofPitch").value); if (!isFinite(v) || v < 0) return;
      State.commit(); s().wall.roofPitchIn12 = v; WallView.render(); refreshSummary();
      $("roofPitch").value = Units.format(s().wall.roofPitchIn12, s().unitsMode);
    });

    $("selStud").onchange = () => {
      const map = { "2x4":[1.5,3.5], "2x6":[1.5,5.5], "2x8":[1.5,7.25] };
      const v = $("selStud").value;
      State.commit();
      s().wall.studNominal = v;
      s().wall.studThickIn = map[v][0];
      s().wall.studDepthIn = map[v][1];
      WallView.render(); refreshSummary();
    };
    $("selSpacing").onchange = () => {
      const nextSpacing = parseFloat($("selSpacing").value);
      State.commit(); s().wall.spacingOC = nextSpacing;
      WallView.render(); refreshSummary();
    };
    $("selTopPlates").onchange = () => {
      const nextTopPlates = parseInt($("selTopPlates").value, 10);
      State.commit(); s().wall.topPlates = nextTopPlates;
      WallView.render(); refreshSummary();
    };
    $("selBottomPlates").onchange = () => {
      const nextBottomPlates = parseInt($("selBottomPlates").value, 10);
      State.commit(); s().wall.bottomPlates = nextBottomPlates;
      WallView.render(); refreshSummary();
    };
    $("selRoofStyle").onchange = () => {
      const nextRoofStyle = $("selRoofStyle").value;
      State.commit(); s().wall.roofStyle = nextRoofStyle;
      syncWallInputsFromState();
      WallView.render(); refreshSummary();
      // Clear user override when roof style changes, so auto-collapse applies
      localStorage.removeItem("collapsed:grpRoof");
      applyAutoCollapse();
    };
    $("selRoofHighSide").onchange = () => {
      const nextRoofHighSide = $("selRoofHighSide").value;
      State.commit(); s().wall.roofHighSide = nextRoofHighSide;
      WallView.render(); refreshSummary();
    };

    $("roofOvLow").addEventListener("change", () => {
      const v = Units.parse($("roofOvLow").value); if (!isFinite(v) || v < 0) return;
      State.commit(); s().wall.roofOverhangLowIn = v; WallView.render(); refreshSummary();
      $("roofOvLow").value = Units.format(s().wall.roofOverhangLowIn, s().unitsMode);
    });
    $("roofOvHigh").addEventListener("change", () => {
      const v = Units.parse($("roofOvHigh").value); if (!isFinite(v) || v < 0) return;
      State.commit(); s().wall.roofOverhangHighIn = v; WallView.render(); refreshSummary();
      $("roofOvHigh").value = Units.format(s().wall.roofOverhangHighIn, s().unitsMode);
    });
    $("selRoofRafter").onchange = () => {
      const map = { "2x6":[1.5,5.5], "2x8":[1.5,7.25], "2x10":[1.5,9.25], "2x12":[1.5,11.25] };
      const v = $("selRoofRafter").value;
      State.commit();
      s().wall.roofRafterNominal = v;
      s().wall.roofRafterThickIn = map[v][0];
      s().wall.roofRafterDepthIn = map[v][1];
      WallView.render(); refreshSummary();
    };
    $("selRoofFascia").onchange = () => {
      const map = { "1x6":[0.75,5.5], "1x8":[0.75,7.25], "2x6":[1.5,5.5], "2x8":[1.5,7.25] };
      const v = $("selRoofFascia").value;
      State.commit();
      s().wall.roofFasciaNominal = v;
      s().wall.roofFasciaThickIn = map[v][0];
      s().wall.roofFasciaDepthIn = map[v][1];
      WallView.render(); refreshSummary();
    };

    $("selFramingPreset").onchange = () => {
      const id = parseInt($("selFramingPreset").value, 10);
      const p = framingPresets.find(x => x.id === id);
      if (!p) return;
      State.commit();
      const w = s().wall;
      w.studNominal = p.stud_nominal;
      w.studThickIn = p.stud_width_in;
      w.studDepthIn = p.stud_depth_in;
      w.spacingOC   = p.spacing_oc_in;
      w.topPlates   = p.top_plates;
      w.bottomPlates = p.bottom_plates;
      syncWallInputsFromState();
      WallView.render(); refreshSummary();
    };
  }

  function bindViewToggles() {
    $("cbShowDims").onchange   = () => { State.get().showDims   = $("cbShowDims").checked;   WallView.render(); };
    $("cbShowLabels").onchange = () => { State.get().showLabels = $("cbShowLabels").checked; WallView.render(); };
    $("cbShowGrid").onchange   = () => { State.get().showGrid   = $("cbShowGrid").checked;   WallView.render(); };
    $("cbColorCode").onchange  = () => { State.get().colorCode  = $("cbColorCode").checked;  WallView.render(); };

    $("rngZoom").oninput = () => {
      WallView.setZoom(parseInt($("rngZoom").value, 10));
      $("zoomLabel").textContent = $("rngZoom").value + "%";
      WallView.render();
    };
    $("btnZoomIn").onclick  = () => { $("rngZoom").value = Math.min(200, parseInt($("rngZoom").value,10)+10); $("rngZoom").oninput(); };
    $("btnZoomOut").onclick = () => { $("rngZoom").value = Math.max(20,  parseInt($("rngZoom").value,10)-10); $("rngZoom").oninput(); };
    $("btnFit").onclick = () => {
      const pct = WallView.fit();
      $("rngZoom").value = pct;
      $("zoomLabel").textContent = pct + "%";
      WallView.render();
    };
  }

  function bindInspector() {
    const ids = ["selLeft","selWidth","selHeight","selHead","selSill","selHeader"];
    ids.forEach(id => Units.wireMeasureInput($(id), () => State.get().unitsMode));

    const commitField = (field, elId, validator) => {
      const val = Units.parse($(elId).value);
      if (!isFinite(val) || (validator && !validator(val))) return;
      const idx = State.get().selectedIdx;
      if (idx < 0) return;
      const s = State.get();
      const original = { ...s.openings[idx] };
      const candidate = { ...original, [field]: val };
      if (!openingFitsRoof(candidate, s.wall)) {
        alert("That opening setting does not fit under the current roof slope.");
        refreshInspector();
        return;
      }
      State.commit();
      State.updateOpening(idx, { [field]: val });
      WallView.render(); refreshSummary();
    };
    $("selLeft").addEventListener("change",   () => commitField("leftIn",   "selLeft",   v => v >= 0));
    $("selWidth").addEventListener("change",  () => commitField("widthIn",  "selWidth",  v => v >  0));
    $("selHeight").addEventListener("change", () => commitField("heightIn", "selHeight", v => v >  0));
    $("selHead").addEventListener("change",   () => commitField("headHeightIn", "selHead", v => v > 0));
    $("selSill").addEventListener("change",   () => commitField("sillHeightIn", "selSill", v => v >= 0));
    $("selHeader").addEventListener("change", () => commitField("headerDepthIn", "selHeader", v => v > 0));

    $("selType").onchange = () => {
      const nextType = $("selType").value;
      const idx = State.get().selectedIdx; if (idx < 0) return;
      const s = State.get();
      const candidate = { ...s.openings[idx], kind: nextType };
      if (!openingFitsRoof(candidate, s.wall)) {
        alert("That opening type does not fit under the current roof slope.");
        refreshInspector();
        return;
      }
      State.commit();
      State.updateOpening(idx, { kind: nextType });
      WallView.render(); refreshSummary();
    };
    $("btnDelOpening").onclick = () => {
      const idx = State.get().selectedIdx; if (idx < 0) return;
      State.removeOpening(idx);
      WallView.render(); refreshSummary();
    };
    $("btnFitToRoof").onclick = () => {
      const s = State.get();
      const idx = s.selectedIdx; if (idx < 0) return;
      const op = s.openings[idx];
      const fit = findNearestValidLeft(op, s.wall, op.leftIn);
      if (fit == null) {
        alert("No valid location exists for this opening under the current roof slope. Reduce its height or header depth.");
        return;
      }
      State.commit();
      State.updateOpening(idx, { leftIn: fit });
      WallView.render(); refreshSummary();
      flashStatus(`Moved opening to ${Units.formatShort(fit, s.unitsMode)} to fit the roof.`);
    };
  }

  function bindKeyboard() {
    window.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || e.target.isContentEditable) return;
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); State.undo(); }
      else if ((e.ctrlKey||e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase()==="z"))) { e.preventDefault(); State.redo(); }
      else if (e.key === "Delete" && State.get().selectedIdx >= 0) State.removeOpening(State.get().selectedIdx);
    });
  }

  // -------------------- Presets --------------------
  function populatePresetSelects() {
    const fp = $("selFramingPreset");
    fp.innerHTML = framingPresets.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
    if (framingPresets.length) fp.value = String(framingPresets[0].id);

    const op = $("selOpeningPreset");
    op.innerHTML = openingPresets.map(p =>
      `<option value="${p.id}">${p.name}</option>`).join("");
  }

  function applyFramingPresetToWall(wall, preset) {
    if (!wall || !preset) return;
    wall.studNominal = preset.stud_nominal;
    wall.studThickIn = preset.stud_width_in;
    wall.studDepthIn = preset.stud_depth_in;
    wall.spacingOC = preset.spacing_oc_in;
    wall.topPlates = preset.top_plates;
    wall.bottomPlates = preset.bottom_plates;
  }

  function applyDefaultFramingPresetToActiveWall() {
    if (!framingPresets.length) return;
    const s = State.get();
    const wall = s.wall;
    const preset = framingPresets[0];
    applyFramingPresetToWall(wall, preset);
    $("selFramingPreset").value = String(preset.id);
    syncWallInputsFromState();
    WallView.render();
    refreshSummary();
  }

  function addFromOpeningPreset() {
    const id = parseInt($("selOpeningPreset").value, 10);
    const p = openingPresets.find(x => x.id === id);
    if (!p) return;
    const wall = State.get().wall;
    const left = findOpenSpot(p.rough_width_in);
    const newOpening = {
      kind: p.kind,
      leftIn: left,
      widthIn: p.rough_width_in,
      heightIn: p.rough_height_in,
      headHeightIn: p.head_height_in,
      sillHeightIn: p.sill_height_in,
      headerDepthIn: p.header_depth_in,
    };
    if (!openingFitsRoof(newOpening, wall)) {
      const adjusted = findValidLeftForOpening(newOpening, wall);
      if (adjusted == null) {
        alert("No valid location for that opening under current roof slope.");
        return;
      }
      newOpening.leftIn = adjusted;
    }
    State.addOpening({
      ...newOpening,
    });
  }

  function addDefaultOpening(kind) {
    const d = kind === "door"
      ? { widthIn: 36, heightIn: 80, headHeightIn: 80, sillHeightIn: 0, headerDepthIn: 3.5 }
      : { widthIn: 36, heightIn: 48, headHeightIn: 72, sillHeightIn: 24, headerDepthIn: 3.5 };
    const left = findOpenSpot(d.widthIn);
    const wall = State.get().wall;
    const newOpening = { kind, leftIn: left, ...d };
    if (!openingFitsRoof(newOpening, wall)) {
      const adjusted = findValidLeftForOpening(newOpening, wall);
      if (adjusted == null) {
        alert("No valid location for that opening under current roof slope.");
        return;
      }
      newOpening.leftIn = adjusted;
    }
    State.addOpening(newOpening);
  }

  function findOpenSpot(widthIn) {
    const s = State.get();
    const gap = (s.wall.studThickIn || 1.5) * 3 + (s.wall.sideClearance || 0) * 2;
    const W = s.wall.lengthIn;
    const sorted = s.openings.slice().sort((a,b) => a.leftIn - b.leftIn);
    let cursor = gap;
    for (const o of sorted) {
      if (o.leftIn - cursor >= widthIn + gap) return cursor;
      cursor = o.leftIn + o.widthIn + gap;
    }
    if (cursor + widthIn + gap <= W) return cursor;
    return Math.max(gap, (W - widthIn) / 2);
  }

  function roofBottomAtX(x, wall) {
    const T = wall.studThickIn || 1.5;
    const topN = Math.max(1, wall.topPlates || 2);
    const H = wall.heightIn;
    const tpBottom = H - topN * T;
    if (wall.roofStyle !== "slope") return tpBottom;
    const slopePerIn = Math.max(0, wall.roofPitchIn12 || 0) / 12;
    if (slopePerIn <= 0) return tpBottom;
    const clampedX = Math.max(0, Math.min(wall.lengthIn, x));
    return wall.roofHighSide === "left"
      ? tpBottom - slopePerIn * clampedX
      : tpBottom - slopePerIn * (wall.lengthIn - clampedX);
  }

  function openingFitsRoof(opening, wall) {
    if (wall.roofStyle !== "slope") return true;
    const T = wall.studThickIn || 1.5;
    const SC = Math.max(0, wall.sideClearance || 0);
    const kingL = opening.leftIn - SC - T * 2;
    const kingR = opening.leftIn + opening.widthIn + SC + T * 2;
    const headerTop = opening.headHeightIn + opening.headerDepthIn;
    const roofMin = Math.min(roofBottomAtX(kingL, wall), roofBottomAtX(kingR, wall));
    return headerTop <= roofMin + 1e-6;
  }

  function findValidLeftForOpening(opening, wall) {
    const maxLeft = wall.lengthIn - opening.widthIn;
    for (let left = 0; left <= maxLeft; left += 1 / 16) {
      if (openingFitsRoof({ ...opening, leftIn: left }, wall)) return left;
    }
    return null;
  }

  // Search outward from a seed position for the nearest valid leftIn.
  function findNearestValidLeft(opening, wall, seedLeft) {
    const maxLeft = Math.max(0, wall.lengthIn - opening.widthIn);
    const step = 1 / 16;
    const seed = Math.max(0, Math.min(maxLeft, seedLeft));
    if (openingFitsRoof({ ...opening, leftIn: seed }, wall)) return seed;
    const limit = Math.ceil(wall.lengthIn / step);
    for (let i = 1; i <= limit; i++) {
      const a = seed - i * step;
      const b = seed + i * step;
      const ok_a = a >= 0 && openingFitsRoof({ ...opening, leftIn: a }, wall);
      const ok_b = b <= maxLeft && openingFitsRoof({ ...opening, leftIn: b }, wall);
      if (ok_a && ok_b) return Math.abs(a - seed) <= Math.abs(b - seed) ? a : b;
      if (ok_a) return a;
      if (ok_b) return b;
      if (a < 0 && b > maxLeft) return null;
    }
    return null;
  }

  // -------------------- Save / Load --------------------
  async function saveProject(forceNew) {
    const s = State.get();
    const payload = {
      name: s.projectName,
      units_mode: s.unitsMode,
      data: State.toDocument(),
    };
    try {
      let proj;
      if (!forceNew && s.projectId) proj = await API.updateProject(s.projectId, payload);
      else proj = await API.createProject(payload);
      s.projectId = proj.id;
      flashStatus(`Saved "${proj.name}"`);
    } catch (e) {
      alert("Save failed: " + e.message);
    }
  }

  let saveAsResolver = null;
  function openSaveAsModal(currentName) {
    const modal = $("modalSaveAs");
    const input = $("saveAsName");
    input.value = currentName;
    modal.classList.remove("hidden");
    input.focus();
    input.select();
    return new Promise((resolve) => {
      saveAsResolver = resolve;
    });
  }

  function closeSaveAsModal(value) {
    const modal = $("modalSaveAs");
    modal.classList.add("hidden");
    if (saveAsResolver) {
      const resolve = saveAsResolver;
      saveAsResolver = null;
      resolve(value);
    }
  }

  async function openProjectsModal() {
    const m = $("modalOpen");
    m.classList.remove("hidden");
    const list = $("projectList");
    list.innerHTML = "<li>Loading…</li>";
    try {
      const rows = await API.listProjects();
      if (!rows.length) { list.innerHTML = "<li class='muted'>No saved projects.</li>"; return; }
      list.innerHTML = "";
      rows.forEach(r => {
        const li = document.createElement("li");
        li.innerHTML =
          `<span><strong>${escapeHtml(r.name)}</strong>
             <div class="muted">${r.updated_at} · ${r.units_mode}</div></span>
           <span class="del" title="Delete">✕</span>`;
        li.querySelector("span").onclick = async () => {
          const full = await API.getProject(r.id);
          State.loadDocument(full.data, full);
          m.classList.add("hidden");
          flashStatus(`Opened "${full.name}"`);
        };
        li.querySelector(".del").onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete "${r.name}"?`)) return;
          await API.deleteProject(r.id);
          openProjectsModal();
        };
        list.appendChild(li);
      });
    } catch (e) { list.innerHTML = `<li>Error: ${escapeHtml(e.message)}</li>`; }
  }

  // -------------------- Refreshers --------------------
  function updateProjectNameUI() {
    const el = $("projectName");
    if (el.textContent !== State.get().projectName) el.textContent = State.get().projectName;
  }
  function updateAuthUI() {
    if ($("sessionEmail")) {
      $("sessionEmail").textContent = currentUser ? currentUser.email : "—";
    }
  }
  function updateUnitsModeUI() {
    $("selUnits").value = State.get().unitsMode;
  }
  function syncWallInputsFromState() {
    const s = State.get();
    const mode = s.unitsMode;
    $("wLength").value = Units.format(s.wall.lengthIn, mode);
    $("wHeight").value = Units.format(s.wall.heightIn, mode);
    $("roofPitch").value = Units.format(s.wall.roofPitchIn12, mode);
    $("sideClearance").value = Units.format(s.wall.sideClearance, mode);
    $("roofOvLow").value  = Units.format(s.wall.roofOverhangLowIn  || 0, mode);
    $("roofOvHigh").value = Units.format(s.wall.roofOverhangHighIn || 0, mode);
    $("selStud").value = s.wall.studNominal;
    $("selSpacing").value = String(s.wall.spacingOC);
    $("selTopPlates").value = String(s.wall.topPlates);
    $("selBottomPlates").value = String(s.wall.bottomPlates);
    $("selRoofStyle").value = s.wall.roofStyle;
    $("selRoofHighSide").value = s.wall.roofHighSide;
    $("selRoofRafter").value = s.wall.roofRafterNominal || "2x6";
    $("selRoofFascia").value = s.wall.roofFasciaNominal || "1x6";
    const showRoof = s.wall.roofStyle === "slope";
    document.querySelectorAll(".roof-row").forEach(el => el.classList.toggle("hidden", !showRoof));
  }

  function refreshInspector() {
    const s = State.get();
    const idx = s.selectedIdx;
    const editor = $("selEditor"), none = $("noSel");
    if (idx < 0 || !s.openings[idx]) { editor.classList.add("hidden"); none.classList.remove("hidden"); return; }
    const o = s.openings[idx];
    editor.classList.remove("hidden"); none.classList.add("hidden");
    $("selType").value = o.kind;
    $("selLeft").value   = Units.format(o.leftIn,  s.unitsMode);
    $("selWidth").value  = Units.format(o.widthIn, s.unitsMode);
    $("selHeight").value = Units.format(o.heightIn, s.unitsMode);
    $("selHead").value   = Units.format(o.headHeightIn, s.unitsMode);
    $("selSill").value   = Units.format(o.sillHeightIn, s.unitsMode);
    $("selHeader").value = Units.format(o.headerDepthIn, s.unitsMode);
    $("rowSill").style.display = (o.kind === "window") ? "" : "none";
    const violates = !openingFitsRoof(o, s.wall);
    $("rowFitRoof").classList.toggle("hidden", !violates);
  }

  function refreshSummary() {
    const c = WallView.getComputed();
    if (!c) return;
    const s = State.get();
    const mode = s.unitsMode;

    // Summary text
    const sm = c.summary;
    $("summary").textContent =
      `Wall: ${Units.formatShort(s.wall.lengthIn, mode)} × ${Units.formatShort(s.wall.heightIn, mode)}\n` +
      (s.wall.roofStyle === "slope"
        ? `Roof: ${Units.formatShort(s.wall.roofPitchIn12, mode)} in 12, ${s.wall.roofHighSide} high, heights ${Units.formatShort(sm.lowWallHeight, mode)} to ${Units.formatShort(sm.highWallHeight, mode)}\n`
        : "") +
      `Verticals: ${sm.studCount}\n` +
      `Openings: ${sm.openings}  (area ${sm.openingArea} ft²)\n` +
      `Net Area: ${sm.netArea} ft²`;

    // Cut list
    const body = document.querySelector("#cutList tbody");
    body.innerHTML = c.cutList.map(r =>
      `<tr><td>${r.part}</td><td>${r.size}</td><td>${Units.formatShort(r.lengthIn, mode)}</td><td>${r.qty}</td></tr>`
    ).join("");

    // Warnings
    const ul = $("warnList");
    ul.innerHTML = c.warnings.length
      ? c.warnings.map(w => `<li class="err">${escapeHtml(w)}</li>`).join("")
      : '<li class="muted" style="list-style:none;margin-left:-14px;">None</li>';

    // Advisory (header span, egress, sheathing)
    const advNotes = [];
    for (let i = 0; i < s.openings.length; i++) {
      advNotes.push(...Advisor.checkOpening(s.openings[i], i));
    }
    const sheets = Advisor.sheathingSheets(s.wall);
    advNotes.push(`Estimated sheathing: ${sheets} × (4×8) panels for one face (10% waste).`);
    const adv = $("advisoryList");
    adv.innerHTML = advNotes.map(n =>
      `<li class="${n.includes("undersized") || n.includes("exceeds") || n.includes("<") || n.includes(">") ? "err" : "muted"}">${escapeHtml(n)}</li>`
    ).join("");

    // Cost & Materials
    const cost = Advisor.costEstimate(c, s.wall);
    const costBody = document.querySelector("#costTable tbody");
    costBody.innerHTML = cost.lines.map(r =>
      `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.qty)}</td><td>${escapeHtml(r.unit)}</td><td>$${r.cost.toFixed(2)}</td></tr>`
    ).join("");
    $("costTotal").textContent = `$${cost.total.toFixed(2)}`;
  }

  function flashStatus(msg) {
    $("statusLine").textContent = msg;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>\"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  // -------------------- Print --------------------
  function doPrint() {
    const s = State.get();
    const c = WallView.getComputed();
    if (!c) return;

    $("printTitle").textContent = s.projectName;
    $("printMeta").textContent =
      `${s.wall.studNominal} @ ${Units.formatShort(s.wall.spacingOC, s.unitsMode)} O.C.  ·  `
      + (s.wall.roofStyle === "slope"
        ? `roof ${Units.formatShort(s.wall.roofPitchIn12, s.unitsMode)} in 12 (${s.wall.roofHighSide} high)  ·  `
        : "")
      + `${Units.formatShort(s.wall.lengthIn, s.unitsMode)} × ${Units.formatShort(s.wall.heightIn, s.unitsMode)}  ·  `
      + `${c.summary.studCount} verticals  ·  ${c.summary.netArea} ft² net`;

    $("printSummary").innerHTML =
      `<div><strong>Openings:</strong> ${c.summary.openings}</div>` +
      `<div><strong>Opening Area:</strong> ${c.summary.openingArea} ft²</div>` +
      `<div><strong>Net Wall Area:</strong> ${c.summary.netArea} ft²</div>`;

    const tbody = document.querySelector("#printCutList tbody");
    tbody.innerHTML = c.cutList.map(r =>
      `<tr><td>${r.part}</td><td>${r.size}</td><td>${Units.formatShort(r.lengthIn, s.unitsMode)}</td><td>${r.qty}</td></tr>`
    ).join("");

    // Render into the print canvas at a higher scale for crisp output.
    const printCanvas = $("printCanvas");
    const origZoom = parseInt($("rngZoom").value, 10);
    WallView.setZoom(90);       // temporarily boost for printing
    WallView.render(printCanvas);
    // restore
    WallView.setZoom(origZoom);
    setTimeout(() => window.print(), 50);
  }

  // -------------------- Multi-wall UI --------------------
  function populateWallTabs() {
    const bar = $("wallTabs");
    if (!bar) return;
    const s = State.get();
    bar.innerHTML = "";
    s.walls.forEach((w, i) => {
      const tab = document.createElement("div");
      tab.className = "wall-tab" + (i === s.activeWallIdx ? " active" : "");
      tab.textContent = w.name;
      tab.title = `Click to edit ${w.name}. Double-click to rename.`;
      tab.addEventListener("click", () => State.setActiveWall(i));
      tab.addEventListener("dblclick", () => {
        const nm = prompt("Rename wall:", w.name);
        if (nm && nm.trim()) State.renameActiveWall(nm.trim());
      });
      bar.appendChild(tab);
    });
    $("btnDelWall").disabled = s.walls.length <= 1;
  }

  function populatePlanWallList() {
    const ul = $("planWallList");
    if (!ul) return;
    const s = State.get();
    ul.innerHTML = "";
    s.walls.forEach((w, i) => {
      const li = document.createElement("li");
      if (i === s.activeWallIdx) li.className = "active";
      li.innerHTML = `<span>${w.name}</span><span class="muted">${Units.formatShort(w.wall.lengthIn, s.unitsMode)}</span>`;
      li.addEventListener("click", () => State.setActiveWall(i));
      ul.appendChild(li);
    });
  }

  function openPlanView() {
    const modal = $("modalPlan");
    modal.classList.remove("hidden");
    PlanView.show(State.get());
    populatePlanWallList();
  }

  function bindPlanView() {
    document.querySelectorAll("#modalPlan [data-close]").forEach(el =>
      el.addEventListener("click", () => $("modalPlan").classList.add("hidden")));
    $("rngPlanZoom").addEventListener("input", () => {
      const pct = parseInt($("rngPlanZoom").value, 10);
      PlanView.setZoom(pct / 100);
      $("planZoomLabel").textContent = pct + "%";
    });
    $("btnPlanZoomIn").onclick  = () => { PlanView.setZoom(PlanView.zoom * 1.2); $("rngPlanZoom").value = String(Math.round(PlanView.zoom * 100)); $("planZoomLabel").textContent = Math.round(PlanView.zoom * 100) + "%"; };
    $("btnPlanZoomOut").onclick = () => { PlanView.setZoom(PlanView.zoom * 0.8); $("rngPlanZoom").value = String(Math.round(PlanView.zoom * 100)); $("planZoomLabel").textContent = Math.round(PlanView.zoom * 100) + "%"; };
    $("btnPlanFit").onclick     = () => { PlanView.fitToWalls(); PlanView.render(); };
    $("cbPlanSnap").onchange    = () => { PlanView.snapDims = $("cbPlanSnap").checked; };
    $("cbPlanDims").onchange    = () => { PlanView.showDims = $("cbPlanDims").checked; PlanView.render(); };
    $("cbPlanCL").onchange      = () => { PlanView.showCenterlineDims = $("cbPlanCL").checked; PlanView.render(); };
    $("btnPlanAutoArrange").onclick = () => PlanView.autoArrangeRectangle();
    $("btnPlanExportSvg").onclick   = () => {
      const s = State.get();
      const svg = SvgExport.exportPlan(s);
      const safe = (s.projectName || "plan").replace(/[^a-z0-9-_]+/gi, "_");
      SvgExport.download(`${safe}_plan.svg`, svg);
    };
    $("btnPlanPrint").onclick = () => {
      // Use print via a simple new window
      const svg = SvgExport.exportPlan(State.get());
      const w = window.open("", "_blank");
      w.document.write(`<!doctype html><html><head><title>Plan</title></head><body style="margin:0">${svg}<script>window.onload=()=>window.print()</script></body></html>`);
      w.document.close();
    };
  }

  // -------------------- Collapsible groups --------------------
  function bindCollapsibles() {
    const toggles = document.querySelectorAll("[data-collapse]");
    toggles.forEach((head) => {
      const id = head.getAttribute("data-collapse");
      const body = document.getElementById(id);
      if (!body) return;
      const storageKey = `collapsed:${id}`;
      const defaultCollapsed = head.getAttribute("data-default") === "collapsed";
      const stored = localStorage.getItem(storageKey);
      const initCollapsed = stored == null ? defaultCollapsed : stored === "1";
      setCollapsed(head, body, initCollapsed);
      head.addEventListener("click", () => {
        const next = !body.classList.contains("collapsed");
        setCollapsed(head, body, next);
        localStorage.setItem(storageKey, next ? "1" : "0");
      });
    });
    // Initial auto-collapse based on current roof style
    applyAutoCollapse();
  }
  function setCollapsed(head, body, on) {
    body.classList.toggle("collapsed", on);
    head.classList.toggle("collapsed", on);
  }
  function applyAutoCollapse() {
    const s = State.get();
    const head = document.querySelector('[data-collapse="grpRoof"][data-auto-collapse]');
    const body = document.getElementById("grpRoof");
    if (!head || !body) return;
    // Only auto-collapse if the user hasn't explicitly opened/closed it
    const storageKey = "collapsed:grpRoof";
    if (localStorage.getItem(storageKey) != null) return;
    const shouldCollapse = s.wall.roofStyle === head.getAttribute("data-auto-collapse");
    setCollapsed(head, body, shouldCollapse);
  }

  // -------------------- Prices modal --------------------
  function bindPricesModal() {
    $("btnEditPrices").onclick = openPricesModal;
    $("btnResetPrices").onclick = () => {
      Advisor.setPrices(Advisor.DEFAULT_PRICES);
      localStorage.removeItem("prices");
      renderPricesGrid();
      refreshSummary();
    };
    document.querySelectorAll("#modalPrices [data-close]").forEach(el =>
      el.addEventListener("click", () => $("modalPrices").classList.add("hidden")));

    // Load saved prices
    try {
      const saved = JSON.parse(localStorage.getItem("prices") || "null");
      if (saved) Advisor.setPrices(saved);
    } catch (e) { /* ignore */ }
  }
  function openPricesModal() {
    renderPricesGrid();
    $("modalPrices").classList.remove("hidden");
  }
  function renderPricesGrid() {
    const grid = $("pricesGrid");
    const prices = Advisor.getPrices();
    grid.innerHTML = "";
    Object.keys(prices).forEach((k) => {
      const label = document.createElement("label");
      label.textContent = k;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.01";
      input.min = "0";
      input.value = prices[k];
      input.addEventListener("change", () => {
        const v = parseFloat(input.value);
        if (!isFinite(v) || v < 0) return;
        const next = Advisor.getPrices();
        next[k] = v;
        Advisor.setPrices(next);
        localStorage.setItem("prices", JSON.stringify(next));
        refreshSummary();
      });
      grid.appendChild(label);
      grid.appendChild(input);
    });
  }

})();
