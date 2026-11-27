// RxNorm and supplier lookup, moved out of the old page script. The steps are unchanged:
// RxNorm identifies the name, the server asks for India listings, and match.js keeps or drops
// each row. This file returns data. chat-ui.js draws it.

(function () {
  var cache = {};

  function strengthNeedle(raw) {
    var match = String(raw || "").toLowerCase().replace(/\s+/g, "").match(/^(\d+(?:\.\d+)?)(mg|mcg|g|units\/ml)$/);
    if (!match) return "";
    return match[1] + " " + match[2].toUpperCase();
  }

  // All concept names RxNorm returns for a name. Cached, so the release check and the search
  // share one call.
  function rxnormConcepts(name) {
    var key = String(name || "").trim().toLowerCase();
    if (!key) return Promise.resolve({ error: true, concepts: [] });
    if (cache[key]) return cache[key];
    var url = "https://rxnav.nlm.nih.gov/REST/drugs.json?name=" + encodeURIComponent(name);
    cache[key] = fetch(url).then(function (response) {
      if (!response.ok) throw new Error("RxNorm status " + response.status);
      return response.json();
    }).then(function (data) {
      var concepts = [];
      var groups = (data && data.drugGroup && data.drugGroup.conceptGroup) || [];
      groups.forEach(function (group) {
        (group.conceptProperties || []).forEach(function (concept) {
          if (concept && concept.rxcui && concept.name) concepts.push({ rxcui: concept.rxcui, name: concept.name });
        });
      });
      return { error: false, concepts: concepts };
    }).catch(function () {
      delete cache[key];
      return { error: true, concepts: [] };
    });
    return cache[key];
  }

  function identify(name, strength) {
    return rxnormConcepts(name).then(function (result) {
      if (result.error) return { error: true };
      if (!result.concepts.length) return { found: false };
      var needle = strengthNeedle(strength);
      var picked = result.concepts[0];
      if (needle) {
        var matched = result.concepts.filter(function (concept) {
          return concept.name.toUpperCase().indexOf(needle) !== -1;
        });
        if (matched.length) picked = matched[0];
      }
      return { found: true, rxcui: picked.rxcui, name: picked.name };
    });
  }

  function conceptNames(name) {
    return rxnormConcepts(name).then(function (result) {
      return result.concepts.map(function (concept) { return concept.name; });
    });
  }

  function liveNote(live) {
    if (!live || live.reason === "missing_key") return "The OpenRouter key is not set on the server, so the sample catalog is shown.";
    if (live.reason === "model_error") return "The supplier lookup failed, so the sample catalog is shown.";
    return "No live supplier page was returned, so the sample catalog is shown.";
  }

  // Resolves to one of these kinds: suppliers, reject, sample, blocked, invalid, unknown.
  function search(input) {
    var match = window.MedFinder;
    return identify(input.name, input.strength).then(function (identity) {
      var local = match.matchDrug(input);
      if (local.status === "blocked" || local.status === "invalid") {
        return { kind: local.status, local: local, identity: identity };
      }
      return fetch("/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          strength: input.strength,
          form: input.form,
          release: input.release,
          rxnormName: identity && identity.name ? identity.name : "",
          rxcui: identity && identity.rxcui ? identity.rxcui : ""
        })
      }).then(function (response) {
        return response.json().then(function (live) {
          if (response.status === 429) {
            return { kind: sampleKind(local), local: local, identity: identity, note: (live && live.message) || "Too many requests. Wait and try again." };
          }
          if (!response.ok) throw new Error("supplier server");
          var filtered = match.filterSuppliers(input, live.suppliers || [], identity && identity.name);
          if (filtered.status === "exact") {
            return { kind: "suppliers", filtered: filtered, identity: identity, live: live, us: match.usSupply(input, live.us) };
          }
          if (filtered.status === "reject") {
            return { kind: "reject", message: filtered.message, identity: identity, live: live };
          }
          return { kind: sampleKind(local), local: local, identity: identity, note: liveNote(live) };
        });
      }).catch(function () {
        return {
          kind: sampleKind(local),
          local: local,
          identity: identity,
          offline: true,
          note: "The MedFinder server isn't reachable from this page, so the sample catalog is shown."
        };
      });
    });
  }

  // A sample-table answer keeps its own status: exact, reject, or unknown.
  function sampleKind(local) {
    if (local.status === "exact") return "sample";
    if (local.status === "reject") return "sample_reject";
    return "unknown";
  }

  window.MedFinderLookup = {
    identify: identify,
    conceptNames: conceptNames,
    search: search
  };
})();
