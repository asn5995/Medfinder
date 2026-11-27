// The app shows live, model-backed listings only. The sample catalog is never shown as a result.
// lookup.js runs here with a fake fetch, so nothing calls RxNorm or OpenRouter.
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var test = require("node:test");
var assert = require("node:assert/strict");

var RXNORM = { drugGroup: { conceptGroup: [{ conceptProperties: [{ rxcui: "617318", name: "atorvastatin 20 MG Oral Tablet [Lipitor]" }] }] } };

function reply(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } });
}

// Loads the page's lookup with a fake network. listings decides what POST /listings returns.
function loadLookup(listings) {
  var window = {
    medfinderApi: function (p) { return "https://server.example" + p; },
    calls: []
  };
  var context = vm.createContext({
    window: window,
    console: console,
    fetch: function (url) {
      window.calls.push(url);
      if (url.indexOf("rxnav.nlm.nih.gov") !== -1) return reply(200, RXNORM);
      return listings();
    }
  });
  ["catalog.js", "match.js", "lookup.js"].forEach(function (file) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "prototype", file), "utf8"), context, { filename: file });
  });
  return window;
}

var lipitor = { name: "Lipitor", strength: "20 mg", form: "tablet", release: "IR" };

function liveRow(strengthValue) {
  return {
    supplier: "PharmEasy",
    brand: "Lipitor",
    ingredient: "atorvastatin",
    salt: "calcium",
    strengthValue: strengthValue,
    strengthUnit: "mg",
    form: "tablet",
    release: "IR",
    packCount: 10,
    packPrice: 800,
    currency: "INR",
    shippingAmount: null,
    shippingKind: "unstated",
    shippingBasis: "",
    pageUrl: "https://pharmeasy.in/example"
  };
}

test("a server that cannot be reached gives no prices, not the sample catalog", async function () {
  var window = loadLookup(function () { return Promise.reject(new Error("offline")); });
  var result = await window.MedFinderLookup.search(lipitor);
  assert.equal(result.kind, "unavailable");
  assert.equal(result.local, undefined);
  assert.ok(window.calls.indexOf("https://server.example/listings") !== -1, "the search goes to the configured server");
});

test("a model failure or a missing key is an error, not sample prices", async function () {
  var failed = await loadLookup(function () { return reply(200, { ok: false, reason: "model_error", suppliers: [] }); }).MedFinderLookup.search(lipitor);
  assert.equal(failed.kind, "error");
  var noKey = await loadLookup(function () { return reply(200, { ok: false, reason: "missing_key", suppliers: [] }); }).MedFinderLookup.search(lipitor);
  assert.equal(noKey.kind, "error");
  assert.match(noKey.message, /key/);
  var limited = await loadLookup(function () { return reply(429, { message: "Too many requests. Wait and try again." }); }).MedFinderLookup.search(lipitor);
  assert.equal(limited.kind, "error");
});

test("no live listing returned means no result shown, not the sample product", async function () {
  var result = await loadLookup(function () { return reply(200, { ok: true, suppliers: [], us: null }); }).MedFinderLookup.search(lipitor);
  assert.equal(result.kind, "none");
  assert.equal(result.local, undefined);
});

test("a live listing that passes the rules is shown, and one that fails is rejected", async function () {
  var exact = await loadLookup(function () { return reply(200, { ok: true, suppliers: [liveRow(20)], us: null }); }).MedFinderLookup.search(lipitor);
  assert.equal(exact.kind, "suppliers");
  assert.equal(exact.filtered.suppliers[0].supplier, "PharmEasy");
  var wrong = await loadLookup(function () { return reply(200, { ok: true, suppliers: [liveRow(40)], us: null }); }).MedFinderLookup.search(lipitor);
  assert.equal(wrong.kind, "reject");
  assert.match(wrong.message, /Strength does not agree/);
});

test("a listing written with the full RxNorm name or 0.05 mg still matches 50 mcg, and a wrong dose does not", async function () {
  var input = { name: "Synthroid", strength: "50 mcg", form: "tablet", release: "IR" };
  function thyronorm(fields) {
    return Object.assign(liveRow(50), { supplier: "PharmEasy", brand: "Thyronorm", ingredient: "levothyroxine sodium 0.05 MG Oral Tablet", salt: "sodium", strengthUnit: "mcg" }, fields);
  }
  var window = loadLookup(function () { return reply(200, { ok: true, suppliers: [thyronorm({})], us: null }); });
  var full = await window.MedFinderLookup.search(input);
  assert.equal(full.kind, "suppliers");
  var mg = await loadLookup(function () { return reply(200, { ok: true, suppliers: [thyronorm({ strengthValue: 0.05, strengthUnit: "mg" })], us: null }); }).MedFinderLookup.search(input);
  assert.equal(mg.kind, "suppliers", "0.05 mg is 50 mcg");
  var wrong = await loadLookup(function () { return reply(200, { ok: true, suppliers: [thyronorm({ strengthValue: 0.1, strengthUnit: "mg" })], us: null }); }).MedFinderLookup.search(input);
  assert.equal(wrong.kind, "reject", "0.1 mg is not 50 mcg");
  var otherDrug = await loadLookup(function () { return reply(200, { ok: true, suppliers: [thyronorm({ ingredient: "liothyronine sodium 0.05 MG Oral Tablet" })], us: null }); }).MedFinderLookup.search(input);
  assert.equal(otherDrug.kind, "reject", "a different ingredient is still rejected");
});

test("an unstated salt passes only for a single-salt ingredient, and a named wrong salt never passes", async function () {
  var atorvastatin = await loadLookup(function () { return reply(200, { ok: true, suppliers: [Object.assign(liveRow(20), { salt: null, brand: "Atorva 20" })], us: null }); }).MedFinderLookup.search(lipitor);
  assert.equal(atorvastatin.kind, "suppliers", "atorvastatin is sold only as the calcium salt");
  var wrongSalt = await loadLookup(function () { return reply(200, { ok: true, suppliers: [Object.assign(liveRow(20), { salt: "sodium" })], us: null }); }).MedFinderLookup.search(lipitor);
  assert.equal(wrongSalt.kind, "reject");
  var metoprolol = { name: "Metoprolol succinate", strength: "50 mg", form: "tablet", release: "ER" };
  function metRow(salt) {
    return Object.assign(liveRow(50), { supplier: "1mg", brand: "Metolar XR", ingredient: "metoprolol", salt: salt, release: "ER" });
  }
  var unstated = await loadLookup(function () { return reply(200, { ok: true, suppliers: [metRow(null)], us: null }); }).MedFinderLookup.search(metoprolol);
  assert.equal(unstated.kind, "reject", "metoprolol is sold as two salts, so the listing must say which");
  var tartrate = await loadLookup(function () { return reply(200, { ok: true, suppliers: [metRow("tartrate")], us: null }); }).MedFinderLookup.search(metoprolol);
  assert.equal(tartrate.kind, "reject");
  var succinate = await loadLookup(function () { return reply(200, { ok: true, suppliers: [metRow("succinate")], us: null }); }).MedFinderLookup.search(metoprolol);
  assert.equal(succinate.kind, "suppliers");
});

test("RxNorm identity uses the concept at the right strength, even when RxNorm writes 50 mcg as 0.05 MG", async function () {
  var window = {
    medfinderApi: function (p) { return p; }
  };
  var concepts = { drugGroup: { conceptGroup: [{ conceptProperties: [
    { rxcui: "1", name: "levothyroxine sodium 0.025 MG Oral Tablet [Synthroid]" },
    { rxcui: "2", name: "levothyroxine sodium 0.05 MG Oral Tablet [Synthroid]" },
    { rxcui: "3", name: "levothyroxine sodium 0.05 MG Oral Tablet" },
    { rxcui: "4", name: "levothyroxine sodium 0.5 MG Oral Tablet" }
  ] }] } };
  var context = vm.createContext({ window: window, console: console, fetch: function () { return reply(200, concepts); } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "prototype", "lookup.js"), "utf8"), context);
  var identity = await window.MedFinderLookup.identify("Synthroid", "50 mcg");
  assert.equal(identity.rxcui, "3");
  assert.equal(identity.strengthMatched, true);
});

test("a real listing without a visible price is kept with no cost, never an estimated one", async function () {
  var unpriced = Object.assign(liveRow(20), { supplier: "1mg", brand: "Ator 20mg Tablet", salt: null, packPrice: null, packCount: null, pageUrl: "https://www.1mg.com/drugs/ator-20mg-tablet-599826" });
  var result = await loadLookup(function () { return reply(200, { ok: true, suppliers: [unpriced, liveRow(20)], us: null }); }).MedFinderLookup.search(lipitor);
  assert.equal(result.kind, "suppliers");
  assert.equal(result.filtered.suppliers.length, 2);
  var noPrice = result.filtered.suppliers.filter(function (row) { return row.supplier === "1mg"; })[0];
  assert.equal(noPrice.cost, null);
  assert.equal(noPrice.packPrice, null);
  var priced = result.filtered.suppliers.filter(function (row) { return row.supplier === "PharmEasy"; })[0];
  assert.equal(priced.cost.landed, 7200);
  var wrongDose = Object.assign({}, unpriced, { strengthValue: 40 });
  var rejected = await loadLookup(function () { return reply(200, { ok: true, suppliers: [wrongDose], us: null }); }).MedFinderLookup.search(lipitor);
  assert.equal(rejected.kind, "reject", "a listing without a price still has to pass every rule");
});

test("a listing price is read from the page's own product data, with its pack size, or not at all", function () {
  var serverLib = require("../server.js");
  function page(ld, title) {
    return "<html><head><title>" + (title || "") + "</title><script type=\"application/ld+json\">" + JSON.stringify(ld) + "</script></head></html>";
  }
  var pharmeasy = page({ "@context": "https://schema.org", "@graph": [
    { "@type": "Organization", "name": "PharmEasy" },
    { "@type": "Drug", "name": "Prolomet Xl 50Mg Strip Of 10 Tablets", "offers": { "price": "48.64", "priceCurrency": "INR" } }
  ] }, "Prolomet Xl 50 MG Tablet (10) | PharmEasy");
  assert.deepEqual(serverLib.readPagePrice(pharmeasy, "https://pharmeasy.in/x"), { packPrice: 48.64, packCount: 10 });

  var netmeds = page([{ "@type": "Drug", "name": "ATORVA 20mg Tablet 15&#39;s", "offers": { "price": "180.26", "priceCurrency": "INR" } }]);
  assert.deepEqual(serverLib.readPagePrice(netmeds, "https://www.netmeds.com/x"), { packPrice: 180.26, packCount: 15 });

  var apollo = page({ "@type": "Drug", "name": "Atorva 20 Tablet ", "offers": { "price": 202.5, "priceCurrency": "INR" } }, "Buy Atorva 20 Tablet online");
  assert.deepEqual(serverLib.readPagePrice(apollo, "https://www.apollopharmacy.in/medicine/atorva-20mg-tablet-15-s"), { packPrice: 202.5, packCount: 15 });

  assert.equal(serverLib.readPagePrice("<html><script>var price = 107.81</script></html>", "https://www.1mg.com/drugs/x"), null, "no product data, no price");
  assert.equal(serverLib.readPagePrice(page({ "@type": "Drug", "name": "Atorva 20 Tablet", "offers": { "price": "202.5", "priceCurrency": "INR" } }), "https://example.in/atorva"), null, "a price without a pack size is not used");
  assert.equal(serverLib.readPagePrice(page({ "@type": "Drug", "name": "Strip of 10", "offers": { "price": "4", "priceCurrency": "USD" } }), "https://example.in/x"), null, "only rupee prices");
  assert.equal(serverLib.readPagePrice("<script type=\"application/ld+json\">{not json</script>", ""), null);
});

test("the supplier search asks for the generic ingredient, not only the US brand", function () {
  var serverLib = require("../server.js");
  assert.equal(serverLib.genericName("levothyroxine sodium 0.05 MG Oral Tablet [Synthroid]"), "levothyroxine sodium");
  assert.equal(serverLib.genericName("24 HR metoprolol succinate 50 MG Extended Release Oral Tablet [Toprol]"), "metoprolol succinate");
  assert.equal(serverLib.genericName(""), "");
});

test("a blocked drug is refused before any search", async function () {
  var window = loadLookup(function () { throw new Error("should not search"); });
  var result = await window.MedFinderLookup.search({ name: "Adderall", strength: "20 mg", form: "tablet", release: "IR" });
  assert.equal(result.kind, "blocked");
  assert.equal(window.calls.indexOf("https://server.example/listings"), -1);
});

test("the chat screen has no sample prices, sample badge, or demo sellers", function () {
  var ui = fs.readFileSync(path.join(__dirname, "..", "prototype", "chat-ui.js"), "utf8");
  var page = fs.readFileSync(path.join(__dirname, "..", "prototype", "index.html"), "utf8");
  ["landedCents", "us90DayCents", "local.product", "sampleState", "Load sample", "Sample data", "MedFinderSellers"].forEach(function (text) {
    assert.equal(ui.indexOf(text), -1, "chat-ui.js still contains " + text);
  });
  assert.equal(page.indexOf("sellers.js"), -1, "the page does not load the demo sellers");
  assert.equal(/sample/i.test(page), false, "the page text does not mention sample data");
});
