// Local supplier lookup. The OpenRouter key stays in .env and is never sent to the browser.
// match.js still decides which rows are shown. This file only asks for public listing fields.

var http = require("http");
var fs = require("fs");
var path = require("path");

var PORT = Number(process.env.PORT) || 8787;
var ROOT = __dirname;
var MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini:online";

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

function readBody(request) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    request.on("data", function (chunk) {
      size += chunk.length;
      if (size > 100000) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", function () {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function cleanSupplier(row) {
  if (!row || typeof row !== "object") return null;
  var pageUrl = String(row.pageUrl || "");
  if (pageUrl.indexOf("https://") !== 0) return null;
  var packPrice = Number(row.packPrice);
  var packCount = Number(row.packCount);
  if (!isFinite(packPrice) || packPrice < 0 || !isFinite(packCount) || packCount <= 0) return null;
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

function askModel(input) {
  var key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return Promise.resolve({ ok: false, reason: "missing_key", suppliers: [], model: MODEL, costUsd: null });
  }

  var instructions = [
    "Find public India e-commerce listings for this medicine.",
    "Return only JSON: {\"suppliers\":[...]}.",
    "Each item needs supplier, brand, ingredient, salt, strengthValue, strengthUnit, form, release, packCount, packPrice, currency, shippingAmount, shippingKind, shippingBasis, pageUrl.",
    "form is tablet, capsule, or injection. release is IR or ER. currency is INR or USD.",
    "shippingKind is page when the seller page states shipping, estimate when you are estimating, or unstated when you cannot support a figure.",
    "If shippingKind is unstated, shippingAmount must be null.",
    "If shippingKind is estimate, shippingBasis must explain the basis in one sentence.",
    "pageUrl must be an https page you found. Do not invent a URL, a price, or a shipping figure.",
    "Return at most five suppliers. If you find none, return an empty suppliers array."
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
        { role: "user", content: JSON.stringify(input) }
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
      var suppliers = (parsed.suppliers || []).map(cleanSupplier).filter(Boolean).slice(0, 5);
      var cost = payload && payload.usage && payload.usage.cost;
      return {
        ok: true,
        reason: "",
        suppliers: suppliers,
        model: MODEL,
        costUsd: typeof cost === "number" ? cost : null
      };
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

var server = http.createServer(function (request, response) {
  var url = new URL(request.url, "http://127.0.0.1:" + PORT);
  if (request.method === "POST" && url.pathname === "/listings") {
    readBody(request).then(function (body) {
      if (isBlocked(body.name)) {
        sendJson(response, 200, { ok: false, reason: "blocked", suppliers: [], model: MODEL, costUsd: null });
        return null;
      }
      return askModel({
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

server.listen(PORT, "127.0.0.1", function () {
  console.log("MedFinder is at http://127.0.0.1:" + PORT + "/prototype/");
});
