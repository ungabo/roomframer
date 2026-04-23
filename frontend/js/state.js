/* state.js — application state + undo/redo history.
 *
 * Document shape (v2, multi-wall):
 *   {
 *     projectId, projectName, unitsMode,
 *     walls: [ { id, name, wall:{...framingProps}, openings:[...],
 *                plan:{x,y,rotationDeg} } ],
 *     activeWallIdx,
 *     selectedIdx,
 *     showDims, showLabels, showGrid, colorCode
 *   }
 *
 * For backward compatibility, `state.wall` and `state.openings` are always
 * proxied to the active wall so legacy UI code continues to work.
 * Old v1 documents with top-level `wall` + `openings` are migrated on load.
 */
(function (global) {
  "use strict";

  const DEFAULT_WALL_PROPS = () => ({
    lengthIn: 16 * 12,           // 16'-0"
    heightIn: 97.125,            // 8'-1 1/8" (std precut)
    studNominal: "2x4",
    studThickIn: 1.5,
    studDepthIn: 3.5,
    spacingOC: 16,
    topPlates: 2,
    bottomPlates: 1,
    roofStyle: "flat",
    roofPitchIn12: 4,
    roofHighSide: "right",
    roofOverhangLowIn: 12,
    roofOverhangHighIn: 6,
    roofRafterNominal: "2x6",
    roofRafterThickIn: 1.5,
    roofRafterDepthIn: 5.5,
    roofFasciaNominal: "1x6",
    roofFasciaDepthIn: 5.5,
    roofFasciaThickIn: 0.75,
    sideClearance: 0.5,
  });

  function newWall(name) {
    return {
      id: "w" + Date.now() + Math.random().toString(36).slice(2, 6),
      name: name || "Wall",
      wall: DEFAULT_WALL_PROPS(),
      openings: [],
      plan: { x: 0, y: 0, rotationDeg: 0 },
    };
  }

  const DEFAULT = () => {
    const first = newWall("Wall 1");
    return {
      projectId: null,
      projectName: "Untitled Project",
      unitsMode: "ftin",
      walls: [first],
      activeWallIdx: 0,
      selectedIdx: -1,
      showDims: true,
      showLabels: true,
      showGrid: false,
      colorCode: true,
      // proxies (kept in sync)
      wall: first.wall,
      openings: first.openings,
    };
  };

  let _state = DEFAULT();
  const undoStack = [];
  const redoStack = [];
  const listeners = [];

  function syncProxies() {
    if (_state.activeWallIdx < 0 || _state.activeWallIdx >= _state.walls.length) {
      _state.activeWallIdx = 0;
    }
    const aw = _state.walls[_state.activeWallIdx];
    if (!aw) return;
    _state.wall = aw.wall;
    _state.openings = aw.openings;
  }

  function snapshot() {
    const { wall, openings, ...rest } = _state;
    return JSON.parse(JSON.stringify(rest));
  }
  function emit() { syncProxies(); listeners.forEach(fn => fn(_state)); }

  function pushHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }

  const State = {
    get: () => _state,
    set(partial) { Object.assign(_state, partial); emit(); },
    replace(next) { _state = next; emit(); },
    reset() { pushHistory(); _state = DEFAULT(); emit(); },
    onChange(fn) { listeners.push(fn); },

    // history
    commit() { pushHistory(); emit(); },
    undo() {
      if (!undoStack.length) return;
      redoStack.push(snapshot());
      _state = undoStack.pop();
      emit();
    },
    redo() {
      if (!redoStack.length) return;
      undoStack.push(snapshot());
      _state = redoStack.pop();
      emit();
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    // multi-wall helpers
    addWall(name) {
      pushHistory();
      const w = newWall(name || `Wall ${_state.walls.length + 1}`);
      _state.walls.push(w);
      _state.activeWallIdx = _state.walls.length - 1;
      _state.selectedIdx = -1;
      emit();
      return w;
    },
    duplicateActiveWall() {
      pushHistory();
      const src = _state.walls[_state.activeWallIdx];
      if (!src) return;
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = "w" + Date.now() + Math.random().toString(36).slice(2, 6);
      copy.name = src.name + " (copy)";
      copy.openings = copy.openings.map((o) => ({ ...o, id: "op" + Math.random().toString(36).slice(2, 8) }));
      copy.plan = { x: (src.plan?.x || 0), y: (src.plan?.y || 0) + 60, rotationDeg: src.plan?.rotationDeg || 0 };
      _state.walls.push(copy);
      _state.activeWallIdx = _state.walls.length - 1;
      _state.selectedIdx = -1;
      emit();
    },
    removeWall(idx) {
      if (_state.walls.length <= 1) return;
      if (idx < 0 || idx >= _state.walls.length) return;
      pushHistory();
      _state.walls.splice(idx, 1);
      if (_state.activeWallIdx >= _state.walls.length) {
        _state.activeWallIdx = _state.walls.length - 1;
      }
      _state.selectedIdx = -1;
      emit();
    },
    setActiveWall(idx) {
      if (idx < 0 || idx >= _state.walls.length) return;
      _state.activeWallIdx = idx;
      _state.selectedIdx = -1;
      emit();
    },
    renameActiveWall(name) {
      const w = _state.walls[_state.activeWallIdx];
      if (!w) return;
      w.name = name || w.name;
      emit();
    },
    updateWallPlan(idx, patch) {
      const w = _state.walls[idx];
      if (!w) return;
      w.plan = Object.assign({ x: 0, y: 0, rotationDeg: 0 }, w.plan, patch);
      emit();
    },
    commitWallPlan() { pushHistory(); emit(); },

    // opening helpers (operate on active wall)
    addOpening(o) {
      pushHistory();
      const id = "op" + Date.now();
      const aw = _state.walls[_state.activeWallIdx];
      aw.openings.push({ id, ...o });
      _state.selectedIdx = aw.openings.length - 1;
      emit();
    },
    updateOpening(idx, patch, withHistory) {
      const aw = _state.walls[_state.activeWallIdx];
      if (!aw || idx < 0 || idx >= aw.openings.length) return;
      if (withHistory) pushHistory();
      Object.assign(aw.openings[idx], patch);
      emit();
    },
    removeOpening(idx) {
      const aw = _state.walls[_state.activeWallIdx];
      if (!aw || idx < 0 || idx >= aw.openings.length) return;
      pushHistory();
      aw.openings.splice(idx, 1);
      _state.selectedIdx = -1;
      emit();
    },
    selectOpening(idx) {
      _state.selectedIdx = idx;
      emit();
    },

    // serialization
    toDocument() {
      return {
        version: 2,
        walls: _state.walls.map((w) => ({
          id: w.id,
          name: w.name,
          wall: w.wall,
          openings: w.openings,
          plan: w.plan,
        })),
        activeWallIdx: _state.activeWallIdx,
        view: {
          showDims: _state.showDims,
          showLabels: _state.showLabels,
          showGrid: _state.showGrid,
          colorCode: _state.colorCode,
        },
      };
    },
    loadDocument(data, meta) {
      pushHistory();
      _state.projectId   = meta.id || null;
      _state.projectName = meta.name || "Untitled Project";
      _state.unitsMode   = meta.units_mode || "ftin";

      let walls = null;
      if (Array.isArray(data.walls) && data.walls.length) {
        walls = data.walls.map((w, i) => ({
          id: w.id || "w" + i + Date.now(),
          name: w.name || `Wall ${i + 1}`,
          wall: Object.assign({}, DEFAULT_WALL_PROPS(), w.wall || {}),
          openings: (w.openings || []).map((o, j) => ({ id: o.id || ("op" + j), ...o })),
          plan: Object.assign({ x: 0, y: 0, rotationDeg: 0 }, w.plan || {}),
        }));
      } else {
        const first = newWall(meta.name || "Wall 1");
        first.wall = Object.assign({}, DEFAULT_WALL_PROPS(), data.wall || {});
        first.openings = (data.openings || []).map((o, i) => ({ id: o.id || ("op" + i), ...o }));
        walls = [first];
      }
      _state.walls = walls;
      _state.activeWallIdx = Math.min(Math.max(0, data.activeWallIdx || 0), walls.length - 1);
      _state.selectedIdx = -1;

      const v = data.view || {};
      _state.showDims   = v.showDims  !== false;
      _state.showLabels = v.showLabels !== false;
      _state.showGrid   = !!v.showGrid;
      _state.colorCode  = v.colorCode !== false;
      emit();
    },
  };

  syncProxies();
  global.State = State;
})(window);
