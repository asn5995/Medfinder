// Where the page sends chat, prescription, supplier, and record requests.
// Served by node server.js (locally or on Render), the page calls its own server.
// GitHub Pages cannot run the server, so the published copy calls the Render service.
// The OpenRouter key stays on that server. It is never in this page.

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.location) {
    var base = api.apiBaseFor(root.location.hostname, root.location.search);
    root.MEDFINDER_API_BASE = base;
    root.medfinderApi = function (path) { return base + path; };
  }
})(typeof window !== "undefined" ? window : null, function () {
  // Must match the service name in render.yaml.
  var PUBLIC_SERVER = "https://as20593-medfinder.onrender.com";

  function isLocal(hostname) {
    return hostname === "127.0.0.1" || hostname === "localhost";
  }

  function apiBaseFor(hostname, search) {
    var host = String(hostname || "").toLowerCase();
    // For local testing only: a page on this computer may point at a server on this computer.
    // A public page ignores ?api=, so a shared link cannot send a prescription somewhere else.
    if (isLocal(host)) {
      var override = "";
      try { override = new URLSearchParams(search || "").get("api") || ""; } catch (error) {}
      if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(override)) return override;
      return "";
    }
    if (/\.github\.io$/.test(host)) return PUBLIC_SERVER;
    return "";
  }

  return { PUBLIC_SERVER: PUBLIC_SERVER, apiBaseFor: apiBaseFor };
});
