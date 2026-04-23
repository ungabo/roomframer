/* auth.js — login/register form handling. */
(function () {
  "use strict";

  const form = document.querySelector("[data-auth-form]");
  if (!form) return;

  const mode = form.getAttribute("data-auth-form");
  const status = document.getElementById("authStatus");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";

    const email = (document.getElementById("email").value || "").trim().toLowerCase();
    const password = document.getElementById("password").value || "";
    const confirmPassword = document.getElementById("confirmPassword");

    if (mode === "register" && confirmPassword && password !== confirmPassword.value) {
      status.textContent = "Passwords do not match.";
      return;
    }

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        let message = `${response.status} ${response.statusText}`;
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const body = await response.json();
          if (body && body.detail) message = body.detail;
        }
        throw new Error(message);
      }

      window.location.href = "/";
    } catch (error) {
      status.textContent = error.message || "Authentication failed.";
    }
  });
})();