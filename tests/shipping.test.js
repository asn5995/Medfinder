var fs = require("fs");
var http = require("http");
var path = require("path");
var child = require("child_process");
var test = require("node:test");
var assert = require("node:assert/strict");
var serverLib = require("../server.js");
var records = require("../lib/records.js");
var limits = require("../lib/limits.js");
var migrate = require("../scripts/migrate.js");

function listen(server) {
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve(server.address().port);
    });
  });
}

function request(port, method, pathname, body, headers) {
  return new Promise(function (resolve, reject) {
    var payload = body == null ? null : Buffer.from(body);
    var req = http.request({
      hostname: "127.0.0.1",
      port: port,
      method: method,
      path: pathname,
      headers: Object.assign(
        payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {},
        headers || {}
      )
    }, function (response) {
      var chunks = [];
      response.on("data", function (chunk) { chunks.push(chunk); });
      response.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8");
        var parsed = text;
        try { parsed = JSON.parse(text); } catch (error) { parsed = text; }
        resolve({ status: response.statusCode, body: parsed, text: text });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function close(server) {
  return new Promise(function (resolve) { server.close(resolve); });
}

test("Render listens on every interface and local development stays on localhost", function () {
  assert.equal(serverLib.listenHost({}), "127.0.0.1");
  assert.equal(serverLib.listenHost({ PORT: "10000" }), "127.0.0.1");
  assert.equal(serverLib.listenHost({ RENDER: "true", PORT: "10000" }), "0.0.0.0");
  assert.equal(serverLib.listenHost({ HOST: "0.0.0.0" }), "0.0.0.0");
});

test("the paid routes return 429 before 30 calls from one visitor", async function () {
  var reads = 0;
  var server = serverLib.createServer({
    rateLimit: 20,
    extractor: {
      extract: function () {
        reads += 1;
        return Promise.resolve({ status: "ok", medications: [], message: "ok" });
      }
    }
  });
  var port = await listen(server);
  try {
    var statuses = [];
    for (var i = 0; i < 30; i += 1) {
      var response = await request(port, "POST", "/extract", JSON.stringify({
        filename: "rx.jpg",
        mimeType: "image/jpeg",
        dataBase64: Buffer.from("x").toString("base64")
      }), { "x-forwarded-for": "203.0.113.10, 10.0.0.1" });
      statuses.push(response.status);
    }
    assert.equal(statuses[19], 200);
    assert.equal(statuses[20], 429);
    assert.equal(statuses[29], 429);
    assert.equal(reads, 20);
    assert.equal(statuses.filter(function (status) { return status === 429; }).length, 10);
  } finally {
    await close(server);
  }
});

test("a blocked drug does not call the model, and dotfiles stay unread", async function () {
  var calls = 0;
  var server = serverLib.createServer({
    ask: function () {
      calls += 1;
      return Promise.resolve({ ok: true, suppliers: [] });
    },
    extractor: {
      extract: function () {
        return Promise.resolve({
          status: "unreadable",
          medications: [],
          reason: "not_a_prescription",
          message: "This file is not a prescription."
        });
      }
    }
  });
  var port = await listen(server);
  try {
    var blocked = await request(port, "POST", "/listings", JSON.stringify({
      name: "Adderall",
      strength: "20 mg",
      form: "tablet",
      release: "IR"
    }));
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.reason, "blocked");
    assert.equal(calls, 0);

    var hidden = await request(port, "GET", "/.env");
    assert.equal(hidden.status, 404);
    assert.equal(String(hidden.text).indexOf("OPENROUTER"), -1);

    var slipped = await request(port, "GET", "/prototype/../.env");
    assert.equal(slipped.status, 404);

    var unreadable = await request(port, "POST", "/extract", JSON.stringify({
      filename: "notes.txt",
      mimeType: "text/plain",
      dataBase64: Buffer.from("hello").toString("base64")
    }));
    assert.equal(unreadable.body.status, "unreadable");
    assert.equal(unreadable.body.medications.length, 0);
  } finally {
    await close(server);
  }
});

test("confirmed text can be stored, and a file body is rejected", async function () {
  var store = records.createMemoryStore();
  var server = serverLib.createServer({ store: store, rateLimit: 20 });
  var port = await listen(server);
  try {
    var saved = await request(port, "POST", "/records", JSON.stringify({
      kind: "prescription",
      record: {
        id: "rx-1",
        patientName: "Demo patient",
        sourceFileName: "rx.jpg",
        savedAt: "2026-11-22",
        medications: [{ name: "Atorvastatin", strength: "20 mg", frequency: "once daily", quantity: "30 tablets", supplyDays: 60 }]
      }
    }));
    assert.equal(saved.status, 200);
    assert.equal(saved.body.stored, true);
    assert.equal(store.saved.prescription[0].medications[0].name, "Atorvastatin");
    assert.equal(store.saved.prescription[0].sourceFileName, "rx.jpg");

    var file = await request(port, "POST", "/records", JSON.stringify({
      kind: "prescription",
      record: {
        id: "rx-2",
        dataBase64: "abc",
        medications: [{ name: "Atorvastatin", supplyDays: 60 }]
      }
    }));
    assert.equal(file.status, 400);
    assert.equal(file.body.reason, "files_not_stored");
    assert.equal(store.saved.prescription.length, 1);

    var unset = serverLib.createServer({ store: records.createUnsetStore() });
    var unsetPort = await listen(unset);
    try {
      var skipped = await request(unsetPort, "POST", "/records", JSON.stringify({
        kind: "order",
        record: {
          id: "order-1",
          name: "Atorvastatin",
          supplyDays: 60,
          leadDays: 20,
          status: "placed"
        }
      }));
      assert.equal(skipped.body.stored, false);
      assert.equal(skipped.body.reason, "database_unset");
    } finally {
      await close(unset);
    }
  } finally {
    await close(server);
  }
});

test("the service role is sent only to the database and the public SQL grants nothing", async function () {
  var seen = [];
  var store = records.createSupabaseStore({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role-test",
    fetch: function (url, options) {
      seen.push({ url: url, authorization: options.headers.Authorization, body: options.body });
      return Promise.resolve({ ok: false, status: 401 });
    }
  });
  var result = await store.save("rating", { orderId: "order-1", stars: 5, comment: "ok", ratedAt: "2026-11-22" });
  assert.equal(result.stored, false);
  assert.equal(result.reason, "database_error");
  assert.equal(JSON.stringify(result).indexOf("service-role-test"), -1);
  assert.equal(seen[0].url, "https://example.supabase.co/rest/v1/ratings");
  assert.equal(seen[0].authorization, "Bearer service-role-test");

  var sql = fs.readFileSync(path.join(__dirname, "../migrations/001_clinic.sql"), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table prescriptions from anon, authenticated/i);
  assert.match(sql, /revoke all on table ratings from anon, authenticated/i);
  assert.equal(sql.indexOf("create policy"), -1);
  assert.equal(sql.toLowerCase().indexOf("bytea"), -1);
  assert.deepEqual(migrate.pendingFiles(["001_clinic.sql", "002_next.sql"], ["001_clinic.sql"]), ["002_next.sql"]);
});

test("migrations do nothing without a database and refuse production", function () {
  var root = path.join(__dirname, "..");
  var blank = child.spawnSync(process.execPath, ["scripts/migrate.js"], {
    cwd: root,
    encoding: "utf8",
    env: Object.assign({}, process.env, { DATABASE_URL: "", MEDFINDER_DATABASE: "" })
  });
  assert.equal(blank.status, 0);
  assert.match(blank.stdout, /DATABASE_URL is unset/);

  var production = child.spawnSync(process.execPath, ["scripts/migrate.js"], {
    cwd: root,
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      DATABASE_URL: "postgres://example.invalid/medfinder",
      MEDFINDER_DATABASE: "production"
    })
  });
  assert.equal(production.status, 0);
  assert.match(production.stdout, /Refusing to change the production database/);
});

test("a visitor key uses the first forwarded address", function () {
  assert.equal(limits.clientKey({ headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.8" }, socket: {} }), "198.51.100.4");
});
