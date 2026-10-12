/*
 * ============================================================
 * GRIM ADMIN SESSION BRIDGE
 * Isolated frontend add-on
 * ============================================================
 *
 * IMPORTANT:
 * Load this script BEFORE /grim-admin/admin.js.
 *
 * It stores only a short-lived signed admin token in sessionStorage.
 * No password, Paystack secret, Supabase secret, or admin secret is stored.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "grim.admin.session.v1";
  const nativeFetch = window.fetch.bind(window);

  function safeString(value) {
    return String(value ?? "");
  }

  function getToken() {
    try {
      return safeString(
        window.sessionStorage.getItem(STORAGE_KEY)
      ).trim();
    } catch (_) {
      return "";
    }
  }

  function setToken(token) {
    try {
      if (token) {
        window.sessionStorage.setItem(STORAGE_KEY, token);
      }
    } catch (_) {}
  }

  function clearToken() {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function requestUrl(input) {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof URL) {
      return input.href;
    }

    return input?.url || "";
  }

  function requestMethod(input, init) {
    return safeString(
      init?.method || input?.method || "GET"
    ).toUpperCase();
  }

  function pathnameFor(input) {
    try {
      return new URL(
        requestUrl(input),
        window.location.origin
      ).pathname;
    } catch (_) {
      return "";
    }
  }

  function isAdminApi(pathname) {
    return pathname.startsWith("/api/admin/");
  }

  async function captureLoginToken(response) {
    if (!response?.ok) {
      return;
    }

    try {
      const data = await response.clone().json();
      const token = safeString(data?.adminSessionToken).trim();

      if (token) {
        setToken(token);
      }
    } catch (_) {}
  }

  window.fetch = async function grimAdminSessionFetch(input, init = {}) {
    const pathname = pathnameFor(input);
    const method = requestMethod(input, init);
    const adminApi = isAdminApi(pathname);

    let finalInit = init;

    if (adminApi) {
      const token = getToken();

      if (token) {
        const sourceHeaders =
          init?.headers ||
          (input instanceof Request ? input.headers : undefined);

        const headers = new Headers(sourceHeaders || {});
        headers.set("Authorization", `Bearer ${token}`);

        finalInit = {
          ...init,
          headers
        };
      }
    }

    const response = await nativeFetch(input, finalInit);

    if (
      pathname === "/api/admin/login" &&
      method === "POST"
    ) {
      await captureLoginToken(response);
    }

    if (
      pathname === "/api/admin/logout" &&
      method === "POST"
    ) {
      clearToken();
    }

    /*
     * If the token is expired/invalid, remove it so the normal admin UI
     * can return to the login screen cleanly.
     */
    if (
      adminApi &&
      response.status === 401 &&
      pathname !== "/api/admin/login"
    ) {
      clearToken();
    }

    return response;
  };

  window.GRIM_ADMIN_SESSION = {
    clear: clearToken,
    active: () => Boolean(getToken())
  };
})();
