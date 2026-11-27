// The published page on GitHub Pages calls the Render server. These checks cover where the page
// sends requests, which sites the server answers in a browser, and the health check.
var http = require("http");
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var config = require("../prototype/config.js");
var serverLib = require("../server.js");

test("the page calls its own server, and GitHub Pages calls the Render service", function () {
  assert.equal(config.apiBaseFor("building-with-ai-f26.github.io", ""), config.PUBLIC_SERVER);
  assert.equal(config.apiBaseFor("127.0.0.1", ""), "");
  assert.equal(config.apiBaseFor("as20593-medfinder.onrender.com", ""), "");
  assert.equal(config.apiBaseFor("localhost", "?api=http://127.0.0.1:8787"), "http://127.0.0.1:8787");
});

test("a public page ignores ?api=, so a link cannot send a prescription elsewhere", function () {
  assert.equal(config.apiBaseFor("building-with-ai-f26.github.io", "?api=https://evil.example"), config.PUBLIC_SERVER);
  assert.equal(config.apiBaseFor("127.0.0.1", "?api=https://evil.example"), "");
  assert.equal(config.apiBaseFor("127.0.0.1", "?api=http://127.0.0.1.evil.example"), "");
});

test("the Render service name matches the address the page calls", function () {
  var blueprint = fs.readFileSync(path.join(__dirname, "..", "render.yaml"), "utf8");
  var name = blueprint.match(/^\s+name:\s*(\S+)/m)[1];
  assert.equal(config.PUBLIC_SERVER, "https://" + name + ".onrender.com");
  assert.match(blueprint, /healthCheckPath: \/health/);
  assert.match(blueprint, /plan: free/);
});

function listen(server) {
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () { resolve(server.address().port); });
  });
}

function call(port, method, pathname, headers, body) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ hostname: "127.0.0.1", port: port, method: method, path: pathname, headers: headers || {} }, function (response) {
      var chunks = [];
      response.on("data", function (chunk) { chunks.push(chunk); });
      response.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8");
        var parsed = text;
        try { parsed = JSON.parse(text); } catch (error) {}
        resolve({ status: response.statusCode, headers: response.headers, body: parsed });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("only the published site may read answers from another origin", async function () {
  var server = serverLib.createServer({
    allowedOrigins: serverLib.allowedOrigins({ ALLOWED_ORIGINS: "http://127.0.0.1:8791" }),
    chat: { turn: function () { return Promise.resolve({ ok: true, status: "ok", reply: "What strength is it?", draft: {}, next: "strength" }); } }
  });
  var port = await listen(server);
  var pages = "https://building-with-ai-f26.github.io";
  try {
    var preflight = await call(port, "OPTIONS", "/chat", { Origin: pages, "Access-Control-Request-Method": "POST" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], pages);
    assert.match(preflight.headers["access-control-allow-headers"], /Content-Type/);

    var chat = await call(port, "POST", "/chat", { Origin: pages, "Content-Type": "application/json" }, JSON.stringify({ messages: [{ role: "user", content: "Lipitor" }] }));
    assert.equal(chat.status, 200);
    assert.equal(chat.headers["access-control-allow-origin"], pages);

    var extra = await call(port, "OPTIONS", "/extract", { Origin: "http://127.0.0.1:8791" });
    assert.equal(extra.status, 204);

    var stranger = await call(port, "OPTIONS", "/chat", { Origin: "https://evil.example" });
    assert.equal(stranger.status, 403);
    assert.equal(stranger.headers["access-control-allow-origin"], undefined);

    var strangerPost = await call(port, "POST", "/chat", { Origin: "https://evil.example", "Content-Type": "application/json" }, JSON.stringify({ messages: [{ role: "user", content: "x" }] }));
    assert.equal(strangerPost.headers["access-control-allow-origin"], undefined);

    var file = await call(port, "GET", "/prototype/config.js", { Origin: pages });
    assert.equal(file.status, 200);
    assert.equal(file.headers["access-control-allow-origin"], undefined, "static files are not opened to other sites");
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
});

test("the health check says whether the OpenRouter key is set, without showing it", async function () {
  var saved = process.env.OPENROUTER_API_KEY;
  var server = serverLib.createServer({});
  var port = await listen(server);
  try {
    process.env.OPENROUTER_API_KEY = "";
    var off = await call(port, "GET", "/health", {});
    assert.deepEqual(off.body, { ok: true, ready: false });
    process.env.OPENROUTER_API_KEY = "test-value-not-a-key";
    var on = await call(port, "GET", "/health", { Origin: "https://building-with-ai-f26.github.io" });
    assert.deepEqual(on.body, { ok: true, ready: true });
    assert.equal(on.headers["access-control-allow-origin"], "https://building-with-ai-f26.github.io");
    assert.equal(JSON.stringify(on.body).indexOf("test-value"), -1);
  } finally {
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved;
    await new Promise(function (resolve) { server.close(resolve); });
  }
});
