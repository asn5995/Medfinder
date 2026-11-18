var test = require("node:test");
var assert = require("node:assert/strict");
var parseExtraction = require("../prototype/extract.js").parseExtraction;
var extractorLib = require("../lib/extractor.js");

function extractor(content, capture) {
  return extractorLib.createPrescriptionExtractor({
    complete: function (messages) {
      if (capture) capture.messages = messages;
      return Promise.resolve({ ok: true, content: content, model: "mock-model", costUsd: 0.002 });
    }
  });
}

var jpeg = {
  filename: "rx photo.jpg",
  mimeType: "image/jpeg",
  dataBase64: Buffer.from("hello").toString("base64")
};

test("parses a fenced model response and drops a blank name", function () {
  var parsed = parseExtraction([
    "```json",
    JSON.stringify({
      readable: true,
      isPrescription: true,
      note: "",
      medications: [
        { name: "Atorvastatin", strength: { value: 20, unit: "mg" }, frequency: "once daily", quantity: "30 tablets", supplyDays: null },
        { name: "  " },
        { medication: "Metformin", dose: "500 mg", sig: "twice daily", qty: "60 tablets", supplyDays: 30 }
      ]
    }),
    "```"
  ].join("\n"));
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.medications.length, 2);
  assert.equal(parsed.medications[0].strength, "20 mg");
  assert.equal(parsed.medications[0].supplyDays, null);
  assert.equal(parsed.medications[1].name, "Metformin");
  assert.equal(parsed.medications[1].frequency, "twice daily");
  assert.equal(parsed.medications[1].supplyDays, 30);
});

test("accepts one medication object instead of an array", function () {
  var parsed = parseExtraction(JSON.stringify({
    medications: { name: "Levothyroxine", strength: "50 mcg", frequency: "daily", quantity: "" }
  }));
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.medications.length, 1);
  assert.equal(parsed.medications[0].quantity, "");
});

test("unreadable and non-prescription replies stay empty", function () {
  var blurry = parseExtraction(JSON.stringify({
    readable: false,
    isPrescription: false,
    medications: [{ name: "Atorvastatin" }],
    note: "The photo is too blurry to read."
  }));
  assert.equal(blurry.status, "unreadable");
  assert.deepEqual(blurry.medications, []);
  assert.match(blurry.message, /blurry/);

  var cat = parseExtraction(JSON.stringify({
    readable: true,
    isPrescription: false,
    medications: [],
    note: "This is a photo of a receipt."
  }));
  assert.equal(cat.status, "not_prescription");
  assert.deepEqual(cat.medications, []);
  assert.match(cat.message, /receipt/);

  var junk = parseExtraction("I could not read that.");
  assert.equal(junk.status, "unreadable");
  assert.equal(parseExtraction("{").status, "unreadable");
  assert.equal(parseExtraction("[]").status, "unreadable");
});

test("a readable prescription with no medicine name is unreadable", function () {
  var parsed = parseExtraction(JSON.stringify({ readable: true, isPrescription: true, medications: [{ strength: "20 mg" }] }));
  assert.equal(parsed.status, "unreadable");
  assert.equal(parsed.medications.length, 0);
});

test("the extractor uses the model interface and does not keep an unread file", async function () {
  var capture = {};
  var result = await extractor(JSON.stringify({
    readable: true,
    isPrescription: true,
    medications: [{ name: "Atorvastatin", strength: "20 mg", frequency: "once daily", quantity: "30 tablets" }]
  }), capture).extract(jpeg);
  assert.equal(result.status, "ok");
  assert.equal(result.medications[0].name, "Atorvastatin");
  assert.equal(result.model, "mock-model");
  assert.equal(result.costUsd, 0.002);
  assert.equal(capture.messages[0].role, "system");
  assert.match(capture.messages[0].content, /Do not invent/);
  assert.equal(capture.messages[1].content[1].type, "image_url");
  assert.match(capture.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test("a PDF is sent as a file and a non-prescription file never calls the model", async function () {
  var calls = 0;
  var reader = extractorLib.createPrescriptionExtractor({
    complete: function (messages) {
      calls += 1;
      assert.equal(messages[1].content[1].type, "file");
      return Promise.resolve({
        ok: true,
        content: JSON.stringify({ readable: true, isPrescription: false, note: "Lab report", medications: [] }),
        model: "mock",
        costUsd: null
      });
    }
  });
  var pdf = await reader.extract({
    filename: "scan.PDF",
    mimeType: "",
    dataBase64: Buffer.from("%PDF").toString("base64")
  });
  assert.equal(pdf.status, "not_prescription");
  assert.equal(calls, 1);

  var skipped = await reader.extract({ filename: "notes.txt", mimeType: "text/plain", dataBase64: Buffer.from("hi").toString("base64") });
  assert.equal(skipped.status, "invalid_file");
  assert.equal(calls, 1);
});

test("a missing key or a model failure is a message, not a crash", async function () {
  var missing = await extractorLib.createPrescriptionExtractor({
    complete: async function () {
      return { ok: false, reason: "missing_key", model: "google/gemini-2.5-flash" };
    }
  }).extract(jpeg);
  assert.equal(missing.status, "unavailable");
  assert.match(missing.message, /OPENROUTER_API_KEY/);

  var failed = await extractorLib.createPrescriptionExtractor({
    complete: async function () {
      return { ok: false, reason: "model_error" };
    }
  }).extract(jpeg);
  assert.equal(failed.status, "unreadable");

  var thrown = await extractorLib.createPrescriptionExtractor({
    complete: function () { return Promise.reject(new Error("down")); }
  }).extract(jpeg);
  assert.equal(thrown.status, "unreadable");
  assert.equal(thrown.medications.length, 0);
});

test("the OpenRouter client does not call the network without a key", async function () {
  var called = false;
  var client = extractorLib.createOpenRouterClient({
    env: {},
    fetch: function () {
      called = true;
      throw new Error("network");
    }
  });
  var result = await client.complete([{ role: "user", content: "hi" }]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_key");
  assert.equal(called, false);
});
