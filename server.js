// Local supplier lookup. The OpenRouter key stays in .env and is never sent to the browser.
// match.js still decides which rows are shown. This file only asks for public listing fields.

var http = require("http");
var fs = require("fs");
var path = require("path");
var extractorLib = require("./lib/extractor.js");
var chatLib = require("./lib/chat.js");
var limits = require("./lib/limits.js");
var records = require("./lib/records.js");

var PORT = Number(process.env.PORT) || 8787;
var ROOT = __dirname;
var MODEL = process.env.OPENROUTER_MODEL || "perplexity/sonar";

loadEnv(path.join(ROOT, ".env"));

var BLOCKED = [
  "adderall",
  "amphetamine salts",
  "mixed amphetamine salts",
  "lantus",
  "insulin glargine",
  "insulin"
];

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split("\n").forEach(function (line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === "#") return;
    var eq = trimmed.indexOf("=");
    if (eq < 1) return;
    var key = trimmed.slice(0, eq).trim();
    var value = trimmed.slice(eq + 1).trim();
    if ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
        (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
}

// "levothyroxine sodium 0.05 MG Oral Tablet [Synthroid]" -> "levothyroxine sodium".
function genericName(rxnormName) {
  return String(rxnormName || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b\d+\s*hr\b/gi, " ")
    .replace(/\d+(?:\.\d+)?\s*(mg|mcg|g|unt\/ml|units\/ml|ml)\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isBlocked(name) {
  var query = normalizeName(name);
  return BLOCKED.some(function (phrase) {
    return query === phrase || new RegExp("(^| )" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( |$)").test(query);
  });
}

function sendJson(response, status, body) {
  var payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store"
  });
  response.end(payload);
}

function readBody(request, limit) {
  var max = limit || 100000;
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    }
    request.on("data", function (chunk) {
      if (settled) return;
      size += chunk.length;
      if (size > max) {
        finish(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", function () {
      if (settled) return;
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        finish(error);
      }
    });
    request.on("error", function (error) { finish(error); });
  });
}

function cleanSupplier(row) {
  if (!row || typeof row !== "object") return null;
  var pageUrl = String(row.pageUrl || "");
  if (pageUrl.indexOf("https://") !== 0) return null;
  // A listing the search found without a visible price is kept, with no price. match.js still checks
  // it, and the page shows it as "price on the seller's page". No price is estimated.
  var packPrice = row.packPrice == null || row.packPrice === "" ? NaN : Number(row.packPrice);
  var packCount = row.packCount == null || row.packCount === "" ? NaN : Number(row.packCount);
  if (!isFinite(packPrice) || packPrice <= 0) packPrice = null;
  if (!isFinite(packCount) || packCount <= 0) packCount = null;
  if (packPrice == null) packCount = packCount || null;
  var kind = normalizeName(row.shippingKind);
  if (kind !== "page" && kind !== "estimate" && kind !== "unstated") kind = "unstated";
  var shippingAmount = row.shippingAmount == null || row.shippingAmount === "" ? null : Number(row.shippingAmount);
  var basis = String(row.shippingBasis || "").trim();
  if (kind === "estimate" && !basis) kind = "unstated";
  if (kind === "unstated" || !isFinite(shippingAmount) || shippingAmount < 0) {
    kind = "unstated";
    shippingAmount = null;
  }
  return {
    supplier: String(row.supplier || "").trim(),
    brand: String(row.brand || "").trim(),
    ingredient: String(row.ingredient || "").trim(),
    salt: String(row.salt || "").trim(),
    strengthValue: row.strengthValue,
    strengthUnit: row.strengthUnit,
    strength: row.strength || null,
    form: String(row.form || "").trim(),
    release: String(row.release || "").trim(),
    packCount: packCount,
    packPrice: packPrice,
    currency: String(row.currency || "INR").trim().toUpperCase(),
    shippingAmount: shippingAmount,
    shippingKind: kind,
    shippingBasis: basis,
    pageUrl: pageUrl
  };
}

function parseModelJson(text) {
  var raw = String(text || "").trim();
  var start = raw.indexOf("{");
  var end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return { suppliers: [] };
  return JSON.parse(raw.slice(start, end + 1));
}

function allowedUsHost(url) {
  try {
    var host = new URL(url).hostname.replace(/^www\./, "");
    return host === "costplusdrugs.com" || host === "goodrx.com" || host === "drugs.com" || host === "singlecare.com";
  } catch (error) {
    return false;
  }
}

function usdInrRate() {
  return fetch("https://api.frankfurter.app/latest?from=USD&to=INR").then(function (response) {
    if (!response.ok) throw new Error("rate");
    return response.json();
  }).then(function (data) {
    var rate = data && data.rates && Number(data.rates.INR);
    if (!isFinite(rate) || rate <= 0) return null;
    return { rate: rate, date: data.date || "" };
  }).catch(function () {
    return null;
  });
}

// Pharmacy pages publish their own product data for search engines (schema.org JSON-LD), for example
// {"@type":"Drug","name":"Prolomet Xl 50Mg Strip Of 10 Tablets","offers":{"price":"48.64","priceCurrency":"INR"}}.
// A price is taken only from that block, and only when the pack size is also on the page. No estimate.
function offerNodes(node, out) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach(function (item) { offerNodes(item, out); });
    return out;
  }
  if (node.offers) out.push(node);
  Object.keys(node).forEach(function (key) { if (key !== "offers") offerNodes(node[key], out); });
  return out;
}

function packCountFrom(text) {
  var value = String(text || "").replace(/&#39;|&#x27;|’/g, "'");
  var match = value.match(/\b(?:strip|bottle|pack|box|packet|tube|vial|jar)\s+of\s+(\d{1,4})\b/i) ||
    value.match(/\b(\d{1,4})\s*'s\b/i) ||
    value.match(/\((\d{1,4})\)/) ||
    value.match(/-(\d{1,4})-s(?:[/?#]|$)/i) ||
    value.match(/\b(\d{1,4})\s+(?:tablets|capsules)\b/i);
  var count = match ? Number(match[1]) : NaN;
  return isFinite(count) && count > 0 && count <= 1000 ? count : null;
}

function readPagePrice(html, url) {
  var text = String(html || "");
  var nodes = [];
  (text.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []).forEach(function (block) {
    try {
      offerNodes(JSON.parse(block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "")), nodes);
    } catch (error) {}
  });
  var title = (text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
  for (var i = 0; i < nodes.length; i += 1) {
    var offer = Array.isArray(nodes[i].offers) ? nodes[i].offers[0] : nodes[i].offers;
    var price = offer ? Number(offer.price != null ? offer.price : offer.lowPrice) : NaN;
    var currency = String((offer && offer.priceCurrency) || "INR").toUpperCase();
    if (!isFinite(price) || price <= 0 || currency !== "INR") continue;
    var count = packCountFrom(nodes[i].name) || packCountFrom(title) || packCountFrom(url);
    if (!count) continue;
    return { packPrice: Math.round(price * 100) / 100, packCount: count };
  }
  return null;
}

// Keeps rows whose page opens. While the page is open, an Indian listing's price and pack size are
// read from the page's own product data, which is more reliable than a search snippet.
function keepLivePages(rows) {
  return Promise.all(rows.map(function (row) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 12000);
    return fetch(row.pageUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" }
    }).then(function (response) {
      var opens = (response.status >= 200 && response.status < 400) || response.status === 403;
      if (!opens || row.currency !== "INR" || response.status !== 200) {
        clearTimeout(timer);
        if (response.body && response.body.cancel) response.body.cancel();
        return opens ? row : null;
      }
      return response.text().then(function (html) {
        clearTimeout(timer);
        var found = readPagePrice(html.slice(0, 5000000), row.pageUrl);
        if (found) return Object.assign({}, row, found, { priceSource: "page" });
        return Object.assign({}, row, { priceSource: row.packPrice != null ? "search" : "" });
      }).catch(function () {
        clearTimeout(timer);
        return row;
      });
    }).catch(function () {
      clearTimeout(timer);
      return null;
    });
  })).then(function (checked) {
    return checked.filter(Boolean);
  });
}

function askModel(input) {
  var key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return Promise.resolve({ ok: false, reason: "missing_key", suppliers: [], model: MODEL, costUsd: null });
  }

  var instructions = [
    "Search Indian online pharmacies for this medicine.",
    "Return only JSON with two keys: suppliers and us.",
    "Each item needs supplier, brand, ingredient, salt, strengthValue, strengthUnit, form, release, packCount, packPrice, currency, shippingAmount, shippingKind, shippingBasis, pageUrl.",
    "ingredient is the active ingredient name only, such as atorvastatin or levothyroxine, without the salt, strength, or form.",
    "salt is calcium, sodium, hydrochloride, succinate, or tartrate, and only when the page or its composition names it. If the page does not name a salt, salt is null. Do not fill it in from what you know.",
    "form is tablet, capsule, or injection. release is IR or ER. currency is INR.",
    "shippingKind is page, estimate, or unstated. If shipping is not stated, shippingKind is unstated and shippingAmount is null.",
    "If shippingKind is estimate, shippingBasis must explain the basis in one sentence.",
    "Use only https URLs from pharmeasy.in, netmeds.com, apollopharmacy.in, or 1mg.com that appear in search results.",
    "Use a different pharmacy for each listing when you can, and prefer pharmeasy.in, netmeds.com, and apollopharmacy.in product pages.",
    "Also return us: one United States retail price for the same ingredient, strength, form, and release.",
    "us needs supplier, brand, ingredient, salt, strengthValue, strengthUnit, form, release, packCount, packPrice, currency, pageUrl.",
    "us.currency is USD. us.pageUrl must be on costplusdrugs.com, goodrx.com, drugs.com, or singlecare.com, not a manufacturer document.",
    "us.packPrice must be a number greater than 0 taken from that page. If the page does not show a price, set us to null.",
    "Prefer listing pages whose pack price and pack size appear in the search results. If a listing's price is not visible, packPrice is null. Do not estimate it.",
    "Do not invent a URL, a price, or a shipping figure. If you cannot find a page, use an empty suppliers array or us null."
  ].join(" ");
  // A US brand such as Synthroid is often not sold in India under that name, so the search asks
  // for the generic ingredient. match.js still checks every row returned.
  var generic = genericName(input.rxnormName) || input.name || "";
  var question = [
    "Find up to 3 current listings sold in India for",
    generic,
    input.strength || "",
    input.form || "",
    (input.release || "") + ".",
    input.name && normalizeName(input.name) !== normalizeName(generic) ? "The patient's US medicine is " + input.name + "." : "",
    input.rxnormName ? "The standardized name is " + input.rxnormName + "." : "",
    "Indian pharmacies usually sell it under other brand names. Any brand counts when the ingredient, salt, strength, form, and release are the same.",
    "Also find one United States retail price for the same strength."
  ].join(" ").replace(/\s+/g, " ");

  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: question }
      ]
    })
  }).then(function (response) {
    return response.json().then(function (payload) {
      if (!response.ok) {
        return { ok: false, reason: "model_error", suppliers: [], model: MODEL, costUsd: null };
      }
      var text = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
      var parsed;
      try {
        parsed = parseModelJson(text);
      } catch (error) {
        parsed = { suppliers: [] };
      }
      var candidates = (parsed.suppliers || []).map(cleanSupplier).filter(Boolean).slice(0, 5);
      if (process.env.MEDFINDER_DEBUG_LISTINGS === "1") {
        console.log("[listings] question: " + question);
        console.log("[listings] raw model output: " + String(text || "").slice(0, 3000));
        console.log("[listings] rows after cleanSupplier: " + candidates.length);
      }
      var usCandidate = cleanSupplier(parsed.us);
      if (usCandidate && (usCandidate.currency !== "USD" || !allowedUsHost(usCandidate.pageUrl) || usCandidate.packPrice == null || usCandidate.packCount == null)) usCandidate = null;
      return Promise.all([
        keepLivePages(candidates),
        usCandidate ? keepLivePages([usCandidate]) : Promise.resolve([]),
        usdInrRate()
      ]).then(function (checked) {
      var cost = payload && payload.usage && payload.usage.cost;
      return {
        ok: true,
        reason: "",
        suppliers: checked[0],
        us: checked[1][0] || null,
        usdInr: checked[2],
        model: MODEL,
        costUsd: typeof cost === "number" ? cost : null
      };
      });
    });
  }).catch(function () {
    return { ok: false, reason: "model_error", suppliers: [], model: MODEL, costUsd: null };
  });
}

function contentType(file) {
  var ext = path.extname(file).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function safeFile(urlPath) {
  var decoded = decodeURIComponent(urlPath.split("?")[0]);
  if (decoded === "/") decoded = "/docs/index.html";
  var file = path.normalize(path.join(ROOT, decoded));
  if (file.indexOf(ROOT) !== 0) return "";
  var relative = path.relative(ROOT, file);
  if (relative.split(path.sep).some(function (part) { return part === ".env" || part.charAt(0) === "." || part === "node_modules"; })) return "";
  return file;
}

// The published page on GitHub Pages calls this server from another origin.
// Only the origins listed here may read its answers in a browser.
var DEFAULT_ORIGINS = ["https://building-with-ai-f26.github.io"];
var API_PATHS = ["/chat", "/extract", "/listings", "/records", "/health"];

function allowedOrigins(env) {
  var listed = String((env || process.env).ALLOWED_ORIGINS || "").split(",").map(function (item) {
    return item.trim().replace(/\/$/, "");
  }).filter(Boolean);
  return DEFAULT_ORIGINS.concat(listed);
}

function listenHost(env) {
  var source = env || process.env;
  if (source.HOST) return source.HOST;
  if (source.RENDER === "true") return "0.0.0.0";
  return "127.0.0.1";
}

function createServer(options) {
  var opts = options || {};
  var extractor = opts.extractor || extractorLib.createPrescriptionExtractor(extractorLib.createOpenRouterClient());
  var extractLimit = opts.extractLimit || 12000000;
  var ask = opts.ask || askModel;
  var allow = limits.createLimiter(
    opts.rateLimit == null ? 20 : opts.rateLimit,
    opts.rateWindowMs == null ? 600000 : opts.rateWindowMs
  );
  var assistant = opts.chat || chatLib.createChatAssistant(extractorLib.createOpenRouterClient({
    model: process.env.OPENROUTER_CHAT_MODEL || "google/gemini-2.5-flash",
    json: true
  }));
  // One conversation takes several turns, so chat has its own, larger per-visitor limit.
  var allowChat = limits.createLimiter(
    opts.chatRateLimit == null ? 60 : opts.chatRateLimit,
    opts.rateWindowMs == null ? 600000 : opts.rateWindowMs
  );
  var keyFor = opts.clientKey || limits.clientKey;
  var store = opts.store || records.storeFromEnv(process.env, typeof fetch === "function" ? fetch : null);
  function tooMany(request, response, limiter) {
    if ((limiter || allow)(keyFor(request))) return false;
    sendJson(response, 429, {
      ok: false,
      status: "rate_limited",
      reason: "rate_limited",
      message: "Too many requests. Wait and try again."
    });
    return true;
  }
  var origins = opts.allowedOrigins || allowedOrigins(process.env);
  return http.createServer(function (request, response) {
  var url = new URL(request.url, "http://127.0.0.1:" + PORT);
  var origin = String(request.headers.origin || "").replace(/\/$/, "");
  var apiPath = API_PATHS.indexOf(url.pathname) !== -1;
  if (apiPath && origin && origins.indexOf(origin) !== -1) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    var preflight = apiPath && origins.indexOf(origin) !== -1;
    response.writeHead(preflight ? 204 : 403, preflight ? {
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600"
    } : {});
    response.end();
    return;
  }

  // The page checks this first. On Render's free plan it also wakes a sleeping server.
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, ready: !!process.env.OPENROUTER_API_KEY });
    return;
  }

  if (request.method === "POST" && url.pathname === "/extract") {
    if (tooMany(request, response)) return;
    readBody(request, extractLimit).then(function (body) {
      return extractor.extract(body).then(function (result) {
        sendJson(response, 200, result);
      });
    }).catch(function (error) {
      var tooLarge = error && error.message === "body too large";
      sendJson(response, 400, {
        status: "invalid_file",
        medications: [],
        reason: tooLarge ? "file_too_large" : "bad_request",
        message: tooLarge
          ? "That file is too large. Upload a photo or PDF under 8 MB."
          : "The upload could not be read. Try a JPG, PNG, WEBP, GIF, or PDF."
      });
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/chat") {
    if (tooMany(request, response, allowChat)) return;
    readBody(request).then(function (body) {
      return assistant.turn(body).then(function (result) {
        sendJson(response, result && result.status === "bad_request" ? 400 : 200, result);
      });
    }).catch(function () {
      sendJson(response, 400, { ok: false, status: "bad_request", reason: "bad_request", message: "The message could not be read." });
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/listings") {
    if (tooMany(request, response)) return;
    readBody(request).then(function (body) {
      if (isBlocked(body.name)) {
        sendJson(response, 200, { ok: false, reason: "blocked", suppliers: [], model: MODEL, costUsd: null });
        return null;
      }
      var query = {
        name: body.name,
        strength: body.strength,
        form: body.form,
        release: body.release,
        rxnormName: body.rxnormName || "",
        rxcui: body.rxcui || ""
      };
      // Search results vary from call to call. One empty answer is retried once, and both costs count.
      return ask(query).then(function (first) {
        if (!first || first.ok === false || (first.suppliers && first.suppliers.length)) return first;
        return ask(query).then(function (second) {
          if (!second || second.ok === false) return first;
          var cost = (typeof first.costUsd === "number" ? first.costUsd : 0) + (typeof second.costUsd === "number" ? second.costUsd : 0);
          return Object.assign({}, second, { costUsd: cost || null, attempts: 2 });
        });
      }).then(function (result) {
        sendJson(response, 200, result);
      });
    }).catch(function () {
      sendJson(response, 400, { ok: false, reason: "bad_request", suppliers: [], model: MODEL, costUsd: null });
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/records") {
    if (tooMany(request, response)) return;
    readBody(request).then(function (body) {
      var normalized = records.normalizeRecord(body && body.kind, body && body.record);
      if (!normalized.ok) {
        sendJson(response, 400, { ok: false, reason: normalized.reason, stored: false });
        return null;
      }
      return store.save(body.kind, normalized.record).then(function (result) {
        sendJson(response, 200, {
          ok: !!result.ok,
          reason: result.reason || "",
          stored: !!result.stored
        });
      });
    }).catch(function () {
      sendJson(response, 400, { ok: false, reason: "bad_request", stored: false });
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { ok: false, reason: "method" });
    return;
  }

  var file = safeFile(url.pathname);
  if (!file) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  fs.stat(file, function (error, stat) {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    var target = stat.isDirectory() ? path.join(file, "index.html") : file;
    fs.readFile(target, function (readError, data) {
      if (readError) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "Content-Type": contentType(target) });
      response.end(request.method === "HEAD" ? undefined : data);
    });
  });
  });
}

if (require.main === module) {
  var host = listenHost(process.env);
  createServer().listen(PORT, host, function () {
    console.log("MedFinder is at http://" + host + ":" + PORT + "/prototype/");
  });
}

module.exports = {
  createServer: createServer,
  listenHost: listenHost,
  allowedOrigins: allowedOrigins,
  genericName: genericName,
  readPagePrice: readPagePrice
};
