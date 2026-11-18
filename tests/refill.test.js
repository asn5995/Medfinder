var test = require("node:test");
var assert = require("node:assert/strict");
var refill = require("../prototype/refill.js");

test("a 60-day supply reminds 20 days before the refill", function () {
  var plan = refill.schedule("2026-01-01", null, null);
  assert.equal(plan.ok, true);
  assert.equal(plan.supplyDays, refill.DEFAULT_SUPPLY_DAYS);
  assert.equal(plan.leadDays, refill.DEFAULT_LEAD_DAYS);
  assert.equal(plan.refillDueOn, refill.addDays("2026-01-01", 60));
  assert.equal(plan.reminderOn, refill.addDays(plan.refillDueOn, -20));
  assert.equal(plan.refillDueOn, "2026-03-02");
  assert.equal(plan.reminderOn, "2026-02-10");
});

test("supply length and lead time can be set per order", function () {
  var plan = refill.schedule("2026-11-18", 30, 7);
  assert.equal(plan.refillDueOn, "2026-12-18");
  assert.equal(plan.reminderOn, "2026-12-11");
  assert.equal(refill.schedule("2026-11-18", 30, 30).reason, "lead_too_long");
  assert.equal(refill.schedule("2026-11-18", 0, 10).reason, "bad_supply");
  assert.equal(refill.schedule("2026-11-18", 10, 0).reason, "bad_lead");
  assert.equal(refill.schedule("18-11-2026", 60, 20).reason, "bad_date");
});

test("dates cross month ends and leap day", function () {
  assert.equal(refill.addDays("2026-01-31", 60), "2026-04-01");
  assert.equal(refill.addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(refill.addDays("2023-02-28", 1), "2023-03-01");
  assert.equal(refill.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(refill.parseIsoDate("2026-02-31"), null);
  assert.equal(refill.addDays("2026-02-31", 1), null);
});

test("the calendar marks refill days in the requested month", function () {
  var cells = refill.monthCells(2026, 11, { "2026-11-18": [{ name: "Atorvastatin", strength: "20 mg" }] });
  assert.equal(cells[0].date, "2026-11-01");
  assert.equal(cells[0].inMonth, true);
  assert.equal(cells.length % 7, 0);
  var due = cells.filter(function (cell) { return cell.date === "2026-11-18"; })[0];
  assert.equal(due.inMonth, true);
  assert.equal(due.refills[0].name, "Atorvastatin");
  var trailing = cells.filter(function (cell) { return cell.date === "2026-12-01"; })[0];
  assert.equal(trailing.inMonth, false);
  assert.equal(refill.monthCells(2026, 13, {}).length, 0);
});
