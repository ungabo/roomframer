/* api.js — thin wrapper around FastAPI endpoints. */
(function (global) {
  "use strict";

  async function j(url, opts) {
    const r = await fetch(url, { credentials: "same-origin", ...opts });
    if (!r.ok) {
      let message = `${r.status} ${r.statusText}`;
      const contentType = r.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await r.json();
        if (body && body.detail) message = body.detail;
      }
      if (r.status === 401 && !/^\/(login|register)$/.test(window.location.pathname)) {
        window.location.href = "/login";
      }
      throw new Error(message);
    }
    if (r.status === 204) return null;
    return r.json();
  }
  const json = (data) => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const API = {
    getSession:        () => j("/api/auth/session"),
    logout:            () => j("/api/auth/logout", { method: "POST" }),

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
