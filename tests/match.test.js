var fs = require("fs");
var path = require("path");
var vm = require("vm");
var test = require("node:test");
var assert = require("node:assert/strict");

test("the existing match rule checks pass without a network call", function () {
  var window = {};
  var context = vm.createContext({ window: window, console: console });
  ["catalog.js", "match.js"].forEach(function (file) {
    var code = fs.readFileSync(path.join(__dirname, "..", "prototype", file), "utf8");
    vm.runInContext(code, context, { filename: file });
  });
  var results = window.MedFinder.runChecks();
  var failed = Array.prototype.map.call(
    results.filter(function (item) { return !item.passed; }),
    function (item) { return item.name; }
  );
  assert.deepEqual(failed, []);
  assert.equal(results.length, 15);
});
