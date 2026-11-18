// Prescription reader. Tests pass a fake complete() so the model is never called.

var parseExtraction = require("../prototype/extract.js").parseExtraction;

var EXTRACT_INSTRUCTIONS = [
  "You read prescription photos and PDFs for a medication cost tool.",
  "Return only one JSON object with keys readable, isPrescription, note, and medications.",
  "readable is false when the file is blank, blurry, cut off, or not text you can read.",
  "isPrescription is false when the file is readable but is not a prescription or medication list.",
  "medications is an array of objects with name, strength, frequency, quantity, and supplyDays.",
  "name is the drug or brand as written. strength is the dose as written, such as 20 mg.",
  "frequency is the directions as written. quantity is the amount dispensed as written.",
  "supplyDays is the number of days the quantity covers only when the prescription states it. Otherwise supplyDays is null.",
  "Copy only what is printed. Do not invent a drug, dose, frequency, or quantity.",
  "If you are unsure of a field, use an empty string. If there are no medications, use an empty array.",
  "note is a short reason when the file is unreadable or not a prescription, otherwise an empty string."
].join(" ");

var MAX_BYTES = 8 * 1024 * 1024;

var MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf"
};

function fileResult(status, message) {
  return { ok: false, status: status, medications: [], message: message };
}

function extensionOf(filename) {
  var name = String(filename || "").toLowerCase();
  var dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1);
}

function normalizeMime(mime, filename) {
  var value = String(mime || "").trim().toLowerCase();
  if (value === "image/jpg") value = "image/jpeg";
  if (MIME_BY_EXT[extensionOf(filename)] && (!value || value === "application/octet-stream")) {
    return MIME_BY_EXT[extensionOf(filename)];
  }
  return value;
}

function stripBase64(value) {
  var text = String(value || "").trim().replace(/\s/g, "");
  var marker = "base64,";
  var markerAt = text.indexOf(marker);
  if (text.indexOf("data:") === 0 && markerAt !== -1) text = text.slice(markerAt + marker.length);
  return text;
}

function decodedLength(b64) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 === 1) return -1;
  var padding = 0;
  if (b64.slice(-2) === "==") padding = 2;
  else if (b64.slice(-1) === "=") padding = 1;
  return Math.floor(b64.length * 3 / 4) - padding;
}

function safeFilename(filename) {
  var base = String(filename || "prescription").split(/[/\\]/).pop();
  return base.replace(/[^\w.\- ]+/g, "").slice(0, 120) || "prescription";
}

function normalizeUpload(upload) {
  var body = upload || {};
  var filename = safeFilename(body.filename);
  var mime = normalizeMime(body.mimeType, filename);
  if (!MIME_BY_EXT[extensionOf(filename)] && mime === "application/octet-stream") {
    mime = MIME_BY_EXT[extensionOf(filename)] || mime;
  }
  var allowed = mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif" || mime === "application/pdf";
  if (!allowed) {
    return fileResult("invalid_file", "Upload a JPG, PNG, WEBP, GIF, or PDF of a prescription.");
  }
  var data = stripBase64(body.dataBase64);
  var bytes = decodedLength(data);
  if (!data || bytes < 0) {
    return fileResult("invalid_file", "That file could not be read. Try a different photo or PDF.");
  }
  if (bytes > MAX_BYTES) {
    return fileResult("invalid_file", "That file is too large. Upload a photo or PDF under 8 MB.");
  }
  var dataUrl = "data:" + mime + ";base64," + data;
  var part = mime === "application/pdf"
    ? { type: "file", file: { filename: filename, file_data: dataUrl } }
    : { type: "image_url", image_url: { url: dataUrl } };
  return { ok: true, filename: filename, mimeType: mime, part: part };
}

function messageText(payload) {
  var message = payload && payload.choices && payload.choices[0] && payload.choices[0].message;
  if (!message) return "";
  var content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(function (part) {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    }).join("\n");
  }
  return "";
}

function createOpenRouterClient(options) {
  var opts = options || {};
  var env = opts.env || process.env;
  var fetchImpl = opts.fetch || fetch;
  var model = opts.model || env.OPENROUTER_EXTRACT_MODEL || "google/gemini-2.5-flash";
  return {
    complete: function (messages) {
      var key = env.OPENROUTER_API_KEY;
      if (!key) {
        return Promise.resolve({ ok: false, reason: "missing_key", content: "", model: model, costUsd: null });
      }
      return fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model,
          temperature: 0,
          messages: messages
        })
      }).then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) {
            return { ok: false, reason: "model_error", content: "", model: model, costUsd: null };
          }
          var cost = payload && payload.usage && payload.usage.cost;
          return {
            ok: true,
            reason: "",
            content: messageText(payload),
            model: model,
            costUsd: typeof cost === "number" ? cost : null
          };
        });
      }).catch(function () {
        return { ok: false, reason: "model_error", content: "", model: model, costUsd: null };
      });
    }
  };
}

function createPrescriptionExtractor(llm) {
  if (!llm || typeof llm.complete !== "function") {
    throw new Error("A prescription extractor needs a complete function.");
  }
  return {
    extract: function (upload) {
      var file = normalizeUpload(upload);
      if (!file.ok) return Promise.resolve(file);
      var messages = [
        { role: "system", content: EXTRACT_INSTRUCTIONS },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this file named " + file.filename + " and return the JSON object." },
            file.part
          ]
        }
      ];
      return llm.complete(messages).then(function (response) {
        if (!response || response.ok === false) {
          if (response && response.reason === "missing_key") {
            return {
              status: "unavailable",
              medications: [],
              message: "Prescription reading needs OPENROUTER_API_KEY in .env. Restart the server after adding it, or enter the medicine by hand.",
              model: response.model || "",
              costUsd: null
            };
          }
          return {
            status: "unreadable",
            medications: [],
            message: "The prescription reader did not answer. Try again, or enter the medicine by hand.",
            model: response && response.model || "",
            costUsd: null
          };
        }
        var parsed = parseExtraction(response.content);
        parsed.model = response.model || "";
        parsed.costUsd = response.costUsd == null ? null : response.costUsd;
        return parsed;
      }).catch(function () {
        return {
          status: "unreadable",
          medications: [],
          message: "The prescription reader did not answer. Try again, or enter the medicine by hand."
        };
      });
    }
  };
}

module.exports = {
  EXTRACT_INSTRUCTIONS: EXTRACT_INSTRUCTIONS,
  normalizeUpload: normalizeUpload,
  createOpenRouterClient: createOpenRouterClient,
  createPrescriptionExtractor: createPrescriptionExtractor
};
