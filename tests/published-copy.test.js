// GitHub Pages serves docs/prototype/. It has to be the same app as prototype/.
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");

var appDir = path.join(__dirname, "..", "prototype");
var pagesDir = path.join(__dirname, "..", "docs", "prototype");

test("the published copy in docs/prototype matches prototype/", function () {
  var appFiles = fs.readdirSync(appDir).sort();
  var pagesFiles = fs.readdirSync(pagesDir).sort();
  assert.deepEqual(pagesFiles, appFiles, "the same files in both folders");
  appFiles.forEach(function (name) {
    var app = fs.readFileSync(path.join(appDir, name), "utf8").replace(/\r\n/g, "\n");
    var pages = fs.readFileSync(path.join(pagesDir, name), "utf8").replace(/\r\n/g, "\n");
    assert.equal(pages, app, name + " differs. Copy prototype/ to docs/prototype/.");
  });
});

test("every script the page loads exists", function () {
  var html = fs.readFileSync(path.join(appDir, "index.html"), "utf8");
  var scripts = (html.match(/<script src="([^"]+)"/g) || []).map(function (tag) { return tag.match(/src="([^"]+)"/)[1]; });
  assert.ok(scripts.length >= 10);
  scripts.forEach(function (src) {
    assert.ok(fs.existsSync(path.join(appDir, src)), src + " is missing");
  });
  assert.equal(html.indexOf("clinic-ui.js"), -1, "the old form script is gone");
});
