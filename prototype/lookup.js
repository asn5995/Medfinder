// RxNorm and supplier lookup, moved out of the old page script. The steps are unchanged:
// RxNorm identifies the name, the server asks for India listings, and match.js keeps or drops
// each row. This file returns data. chat-ui.js draws it.

(function () {
  var cache = {};

  // RxNorm writes 50 mcg as "0.05 MG", so both spellings are looked for.
  function strengthNeedles(raw) {
    var match = String(raw || "").toLowerCase().replace(/\s+/g, "").match(/^(\d+(?:\.\d+)?)(mg|mcg|g|units\/ml)$/);
    if (!match) return [];
    var value = Number(match[1]);
    var needles = [value + " " + match[2].toUpperCase()];
    if (match[2] === "mcg") needles.push(String(value / 1000) + " MG");
    if (match[2] === "g") needles.push(String(value * 1000) + " MG");
    return needles;
  }

  function hasStrength(name, needles) {
    var upper = " " + String(name || "").toUpperCase().replace(/\s+/g, " ");
    return needles.some(function (needle) {
      return new RegExp("[^\\d.]" + needle.replace(/[.]/g, "\\.") + "(?![A-Z/])").test(upper);
    });
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
      var needles = strengthNeedles(strength);
      var matched = needles.length ? result.concepts.filter(function (concept) { return hasStrength(concept.name, needles); }) : [];
      // A plain generic name ("levothyroxine sodium 0.05 MG Oral Tablet") is preferred over a branded pack.
      var plainFirst = matched.filter(function (concept) { return concept.name.indexOf("[") === -1; }).concat(matched);
      var picked = plainFirst[0] || result.concepts[0];
      return { found: true, rxcui: picked.rxcui, name: picked.name, strengthMatched: matched.length > 0 };
    });
  }

  function conceptNames(name) {
    return rxnormConcepts(name).then(function (result) {
      return result.concepts.map(function (concept) { return concept.name; });
    });
  }

  function errorText(live) {
    if (live && live.reason === "missing_key") return "The server's OpenRouter key isn't set, so the live search can't run.";
    return "The live search didn't answer. Try again in a moment.";
  }

  // Live search only. No sample prices are ever shown.
  // Resolves to one of these kinds: suppliers, reject, none, blocked, invalid, error, unavailable.
  function search(input) {
    var match = window.MedFinder;
    return identify(input.name, input.strength).then(function (identity) {
      // match.js still refuses blocked drugs and incomplete details before anything is searched.
      var local = match.matchDrug(input);
      if (local.status === "blocked" || local.status === "invalid") {
        return { kind: local.status, local: local, identity: identity };
      }
      return fetch(window.medfinderApi("/listings"), {
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
            return { kind: "error", identity: identity, message: (live && live.message) || "Too many requests. Wait a few minutes and try again." };
          }
          if (!response.ok) throw new Error("supplier server");
          if (live && live.ok === false) {
            if (live.reason === "blocked") return { kind: "blocked", local: local, identity: identity };
            return { kind: "error", identity: identity, message: errorText(live), live: live };
          }
          var filtered = match.filterSuppliers(input, live.suppliers || [], identity && identity.name);
          if (filtered.status === "exact") {
            return { kind: "suppliers", filtered: filtered, identity: identity, live: live, us: match.usSupply(input, live.us) };
          }
          if (filtered.status === "reject") {
            return { kind: "reject", message: filtered.message, identity: identity, live: live };
          }
          return { kind: "none", identity: identity, live: live };
        });
      }).catch(function () {
        return { kind: "unavailable", identity: identity };
      });
    });
  }

  window.MedFinderLookup = {
    identify: identify,
    conceptNames: conceptNames,
    search: search
  };
})();
