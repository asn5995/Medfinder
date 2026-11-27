var http = require("http");
var test = require("node:test");
var assert = require("node:assert/strict");
var createServer = require("../server.js").createServer;

function listen(server) {
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve(server.address().port);
    });
  });
}

function request(port, method, pathname, body) {
  return new Promise(function (resolve, reject) {
    var payload = body == null ? null : Buffer.from(body);
    var req = http.request({
      hostname: "127.0.0.1",
      port: port,
      method: method,
      path: pathname,
      headers: payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}
    }, function (response) {
      var chunks = [];
      response.on("data", function (chunk) { chunks.push(chunk); });
      response.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8");
        var parsed = text;
        try { parsed = JSON.parse(text); } catch (error) { parsed = text; }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("the extract route returns the mocked reader and rejects a bad upload", async function () {
  var calls = [];
  var server = createServer({
    extractLimit: 80,
    extractor: {
      extract: function (upload) {
        calls.push(upload.filename);
        return Promise.resolve({
          status: "ok",
          medications: [{ name: "Atorvastatin", strength: "20 mg", frequency: "once daily", quantity: "30 tablets", supplyDays: null }],
          message: "Check these fields, then save."
        });
      }
    }
  });
  var port = await listen(server);
  try {
    var ok = await request(port, "POST", "/extract", JSON.stringify({
      filename: "rx.jpg",
      mimeType: "image/jpeg",
      dataBase64: Buffer.from("hello").toString("base64")
    }));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.medications[0].name, "Atorvastatin");
    assert.deepEqual(calls, ["rx.jpg"]);

    var bad = await request(port, "POST", "/extract", "{");
    assert.equal(bad.status, 400);
    assert.equal(bad.body.status, "invalid_file");

    var huge = await request(port, "POST", "/extract", JSON.stringify({ filename: "big.jpg", dataBase64: "a".repeat(200) }));
    assert.equal(huge.status, 400);
    assert.equal(huge.body.reason, "file_too_large");
    assert.equal(calls.length, 1);

    var file = await request(port, "GET", "/prototype/refill.js");
    assert.equal(file.status, 200);
    assert.match(file.body, /DEFAULT_SUPPLY_DAYS/);
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
});

test("the chat route uses the mocked assistant, refuses bad bodies, and has its own limit", async function () {
  var turns = 0;
  var server = createServer({
    chatRateLimit: 3,
    rateLimit: 1,
    chat: {
      turn: function (body) {
        turns += 1;
        if (!body.messages || !body.messages.length) {
          return Promise.resolve({ ok: false, status: "bad_request", reason: "bad_request", message: "Send the patient's message." });
        }
        return Promise.resolve({ ok: true, status: "ok", reply: "What strength is it?", draft: { name: "Lipitor" }, next: "strength" });
      }
    },
    extractor: { extract: function () { return Promise.resolve({ status: "ok", medications: [] }); } }
  });
  var port = await listen(server);
  try {
    var ok = await request(port, "POST", "/chat", JSON.stringify({ messages: [{ role: "user", content: "Lipitor" }], draft: {} }));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.next, "strength");

    var empty = await request(port, "POST", "/chat", JSON.stringify({ messages: [] }));
    assert.equal(empty.status, 400);

    var broken = await request(port, "POST", "/chat", "{");
    assert.equal(broken.status, 400);
    assert.equal(turns, 2);

    var limited = await request(port, "POST", "/chat", JSON.stringify({ messages: [{ role: "user", content: "x" }] }));
    assert.equal(limited.status, 429);

    var extract = await request(port, "POST", "/extract", JSON.stringify({ filename: "a.png", dataBase64: "" }));
    assert.equal(extract.status, 200, "chat turns do not use up the shared limit");
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
});
