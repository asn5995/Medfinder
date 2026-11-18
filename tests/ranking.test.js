var test = require("node:test");
var assert = require("node:assert/strict");
var ranking = require("../prototype/ranking.js");
var sellers = require("../prototype/sellers.js");

function indexOf(ranked, id) {
  return ranked.findIndex(function (seller) { return seller.id === id; });
}

test("the smoothed average follows the published formula", function () {
  var score = ranking.scoreSeller({
    id: "new",
    name: "New",
    ratings: [5],
    assignedCount: 1,
    fulfilledCount: 1
  });
  var average = (ranking.PRIOR_COUNT * ranking.PRIOR_MEAN + 5) / (ranking.PRIOR_COUNT + 1);
  var reliability = (ranking.RELIABILITY_COUNT * ranking.RELIABILITY_PRIOR + 1) / (ranking.RELIABILITY_COUNT + 1);
  var combined = ranking.RATING_WEIGHT * (average / 5) + ranking.RELIABILITY_WEIGHT * reliability;
  assert.ok(Math.abs(score.ratingAverage - average) < 1e-12);
  assert.ok(Math.abs(score.reliability - reliability) < 1e-12);
  assert.ok(Math.abs(score.rankingScore - combined) < 1e-12);
  assert.ok(score.ratingAverage < 4);
});

test("no ratings use the prior, and a bad star is ignored", function () {
  var fresh = ranking.scoreSeller({ id: "fresh", ratings: [], assignedCount: 0, fulfilledCount: 0 });
  assert.equal(fresh.ratingAverage, ranking.PRIOR_MEAN);
  assert.ok(Math.abs(fresh.reliability - ranking.RELIABILITY_PRIOR) < 1e-12);
  assert.equal(fresh.rawAverage, null);

  var messy = ranking.scoreSeller({ id: "messy", ratings: [5, 9, 0, { stars: 4 }, "nope"], assignedCount: 4, fulfilledCount: 9 });
  assert.equal(messy.ratingCount, 2);
  assert.equal(messy.fulfilledCount, 4);
  assert.ok(messy.reliability <= 1);
});

test("one 5-star seller does not outrank a longer strong record", function () {
  var ranked = ranking.rankSellers(sellers.list());
  var ids = ranked.map(function (seller) { return seller.id; });
  assert.deepEqual(
    ids,
    ["apollo", "netmeds", "pharmeasy", "newchem", "citymed", "medplus"],
    ranked.map(function (seller) { return seller.id + " " + seller.rankingScore.toFixed(4); }).join(", ")
  );
  assert.ok(indexOf(ranked, "newchem") > indexOf(ranked, "apollo"));
  assert.ok(indexOf(ranked, "newchem") > indexOf(ranked, "pharmeasy"));
  assert.ok(indexOf(ranked, "citymed") < indexOf(ranked, "medplus"));
  var newbie = ranked[indexOf(ranked, "newchem")];
  assert.equal(newbie.ratingCount, 1);
  assert.ok(newbie.ratingAverage < newbie.rawAverage);
});

test("a lower rating lowers the score and shares sum to one", function () {
  var before = ranking.scoreSeller({ id: "a", ratings: [5, 5, 5], assignedCount: 3, fulfilledCount: 3 });
  var after = ranking.scoreSeller({ id: "a", ratings: [5, 5, 5, 1], assignedCount: 4, fulfilledCount: 4 });
  assert.ok(after.ratingAverage < before.ratingAverage);
  assert.ok(after.rankingScore < before.rankingScore);

  var shares = ranking.orderShares(sellers.list());
  var total = shares.reduce(function (sum, seller) { return sum + seller.share; }, 0);
  assert.ok(Math.abs(total - 1) < 1e-12);
  assert.ok(shares[0].share > shares[shares.length - 1].share);
});

test("assignment draws higher-ranked sellers more often", function () {
  var board = [
    { id: "high", name: "High", ratings: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], assignedCount: 40, fulfilledCount: 39 },
    { id: "mid", name: "Mid", ratings: [4, 4, 4, 4, 4, 4, 4, 4], assignedCount: 16, fulfilledCount: 12 },
    { id: "low", name: "Low", ratings: [1, 2, 1, 1], assignedCount: 12, fulfilledCount: 3 }
  ];
  assert.equal(ranking.assignSeller(board, function () { return 0; }).id, "high");
  assert.equal(ranking.assignSeller(board, function () { return 0.999999; }).id, "low");
  assert.equal(ranking.assignSeller([], function () { return 0; }), null);

  var seed = 7;
  function random() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }
  var counts = { high: 0, mid: 0, low: 0 };
  for (var i = 0; i < 3000; i++) counts[ranking.assignSeller(board, random).id] += 1;
  assert.ok(counts.high > counts.mid);
  assert.ok(counts.mid > counts.low);
});
