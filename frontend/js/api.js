/* api.js — thin wrapper around FastAPI endpoints. */
(function (global) {
  "use strict";

  async function j(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    if (r.status === 204) return null;
    return r.json();
  }
  const json = (data) => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const API = {
    listProjects:      () => j("/api/projects"),
    getProject:        (id) => j("/api/projects/" + id),
    createProject:     (payload) => j("/api/projects", { method: "POST", ...json(payload) }),
    updateProject:     (id, payload) => j("/api/projects/" + id, { method: "PUT", ...json(payload) }),
    deleteProject:     (id) => j("/api/projects/" + id, { method: "DELETE" }),

    listFramingPresets: () => j("/api/presets/framing"),
    listOpeningPresets: () => j("/api/presets/openings"),
  };

  global.API = API;
})(window);
