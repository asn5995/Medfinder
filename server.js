// Local supplier lookup. The OpenRouter key stays in .env and is never sent to the browser.
// match.js still decides which rows are shown. This file only asks for public listing fields.

var http = require("http");
var fs = require("fs");
var path = require("path");
var extractorLib = require("./lib/extractor.js");
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
  var packPrice = Number(row.packPrice);
  var packCount = Number(row.packCount);
  if (!isFinite(packPrice) || packPrice <= 0 || !isFinite(packCount) || packCount <= 0) return null;
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

function keepLivePages(rows) {
  return Promise.all(rows.map(function (row) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 8000);
    return fetch(row.pageUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" }
    }).then(function (response) {
      clearTimeout(timer);
      if (response.body && response.body.cancel) response.body.cancel();
      return (response.status >= 200 && response.status < 400) || response.status === 403 ? row : null;
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
    "salt is calcium, sodium, hydrochloride, succinate, or tartrate.",
    "form is tablet, capsule, or injection. release is IR or ER. currency is INR.",
    "shippingKind is page, estimate, or unstated. If shipping is not stated, shippingKind is unstated and shippingAmount is null.",
    "If shippingKind is estimate, shippingBasis must explain the basis in one sentence.",
    "Use only https URLs from 1mg.com, pharmeasy.in, netmeds.com, or apollopharmacy.in that appear in search results.",
    "Also return us: one United States retail price for the same ingredient, strength, form, and release.",
    "us needs supplier, brand, ingredient, salt, strengthValue, strengthUnit, form, release, packCount, packPrice, currency, pageUrl.",
    "us.currency is USD. us.pageUrl must be on costplusdrugs.com, goodrx.com, drugs.com, or singlecare.com, not a manufacturer document.",
    "us.packPrice must be a number greater than 0 taken from that page. If the page does not show a price, set us to null.",
    "Do not invent a URL, a price, or a shipping figure. If you cannot find a page, use an empty suppliers array or us null."
  ].join(" ");
  var question = [
    "Find up to 3 current listings sold in India for",
    input.name || "",
    input.strength || "",
    input.form || "",
    (input.release || "") + ".",
    input.rxnormName ? "The standardized name is " + input.rxnormName + "." : "",
    "Also find one United States retail price for the same strength."
  ].join(" ");

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
      var usCandidate = cleanSupplier(parsed.us);
      if (usCandidate && (usCandidate.currency !== "USD" || !allowedUsHost(usCandidate.pageUrl))) usCandidate = null;
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
  var keyFor = opts.clientKey || limits.clientKey;
  var store = opts.store || records.storeFromEnv(process.env, typeof fetch === "function" ? fetch : null);
  function tooMany(request, response) {
    if (allow(keyFor(request))) return false;
    sendJson(response, 429, {
      ok: false,
      status: "rate_limited",
      reason: "rate_limited",
      message: "Too many requests. Wait and try again."
    });
    return true;
  }
  return http.createServer(function (request, response) {
  var url = new URL(request.url, "http://127.0.0.1:" + PORT);
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

  if (request.method === "POST" && url.pathname === "/listings") {
    if (tooMany(request, response)) return;
    readBody(request).then(function (body) {
      if (isBlocked(body.name)) {
        sendJson(response, 200, { ok: false, reason: "blocked", suppliers: [], model: MODEL, costUsd: null });
        return null;
      }
      return ask({
        name: body.name,
        strength: body.strength,
        form: body.form,
        release: body.release,
        rxnormName: body.rxnormName || "",
        rxcui: body.rxcui || ""
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

module.exports = { createServer: createServer, listenHost: listenHost };
