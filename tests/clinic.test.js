var test = require("node:test");
var assert = require("node:assert/strict");
var clinic = require("../prototype/clinic.js");
var refill = require("../prototype/refill.js");
var ranking = require("../prototype/ranking.js");
var sellers = require("../prototype/sellers.js");

function ids() {
  var n = 0;
  return function (prefix) {
    n += 1;
    return prefix + "-" + n;
  };
}

test("a confirmed prescription can be ordered, reminded, and rated once", function () {
  var today = "2026-11-18";
  var saved = clinic.confirmPrescription(clinic.emptyState(), {
    sourceFileName: "rx.jpg",
    savedAt: today,
    medications: [
      { name: "  Atorvastatin ", strength: "20 mg", frequency: "once daily", quantity: "60 tablets", supplyDays: 90 },
      { name: "" }
    ]
  }, { id: ids() });
  assert.equal(saved.ok, true);
  assert.equal(saved.prescription.medications.length, 1);
  assert.equal(saved.prescription.medications[0].supplyDays, 90);

  var ordered = clinic.placeOrder(saved.state, {
    name: saved.prescription.medications[0].name,
    strength: "20 mg",
    frequency: "once daily",
    quantity: "60 tablets",
    supplyDays: 90,
    leadDays: 20,
    orderedAt: "2026-11-01",
    prescriptionId: saved.prescription.id,
    sellerId: "apollo"
  }, { id: ids(), sellers: sellers.list() });
  assert.equal(ordered.order.refillDueOn, refill.addDays("2026-11-01", 90));
  assert.equal(ordered.order.reminderOn, refill.addDays(ordered.order.refillDueOn, -20));
  assert.equal(clinic.reminders(ordered.state, "2026-11-18").length, 0);
  assert.equal(clinic.reminders(ordered.state, ordered.order.reminderOn).length, 1);
  assert.match(clinic.reminders(ordered.state, ordered.order.refillDueOn)[0].message, /place another order/);
  assert.match(clinic.reminders(ordered.state, refill.addDays(ordered.order.refillDueOn, 1))[0].message, /was due/);

  var tooSoon = clinic.rateOrder(ordered.state, ordered.order.id, { stars: 5, comment: "early" });
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.reason, "not_fulfilled");
  assert.equal(ordered.state.orders[0].rating, null);

  var fulfilled = clinic.fulfillOrder(ordered.state, ordered.order.id, today);
  var original = fulfilled.state;
  var rated = clinic.rateOrder(original, ordered.order.id, { stars: 4, comment: " Pack was sealed. ", ratedAt: today });
  assert.equal(rated.ok, true);
  assert.equal(original.orders[0].rating, null);
  assert.equal(rated.state.orders[0].rating.stars, 4);
  assert.equal(rated.state.orders[0].rating.comment, "Pack was sealed.");
  var again = clinic.rateOrder(rated.state, ordered.order.id, { stars: 5 });
  assert.equal(again.reason, "already_rated");
  assert.equal(again.state.orders[0].rating.stars, 4);
  assert.equal(clinic.rateOrder(rated.state, ordered.order.id, { stars: 6 }).reason, "bad_stars");

  var board = ranking.rankSellers(clinic.projectSellers(sellers.list(), rated.state.orders));
  var apollo = board.filter(function (seller) { return seller.id === "apollo"; })[0];
  assert.equal(apollo.ratingCount, 21);
  assert.equal(apollo.assignedCount, 49);
  assert.equal(apollo.fulfilledCount, 47);
});

test("a newer order replaces the reminder, and blocked drugs are not ordered", function () {
  var options = { id: ids(), sellers: sellers.list(), matchDrug: function (input) {
    return { status: input.name.toLowerCase() === "adderall" ? "blocked" : "unknown", message: "Blocked." };
  } };
  var first = clinic.placeOrder(clinic.emptyState(), {
    name: "Atorvastatin",
    strength: "20 mg",
    supplyDays: 60,
    leadDays: 20,
    orderedAt: "2026-01-01",
    sellerId: "netmeds"
  }, options);
  var second = clinic.placeOrder(first.state, {
    name: "Atorvastatin",
    strength: "20 mg",
    supplyDays: 60,
    leadDays: 20,
    orderedAt: "2026-03-01",
    sellerId: "apollo"
  }, options);
  var notes = clinic.reminders(second.state, "2026-02-15");
  assert.equal(notes.length, 0);
  assert.equal(clinic.activeOrders(second.state.orders)[0].id, second.order.id);

  var otherStrength = clinic.placeOrder(second.state, {
    name: "Atorvastatin",
    strength: "40 mg",
    orderedAt: "2026-01-01",
    sellerId: "apollo"
  }, options);
  assert.equal(clinic.reminders(otherStrength.state, "2026-02-15").length, 1);

  var blocked = clinic.placeOrder(clinic.emptyState(), {
    name: "Adderall",
    strength: "20 mg",
    orderedAt: "2026-11-18"
  }, options);
  assert.equal(blocked.reason, "blocked");
  assert.equal(blocked.state.orders.length, 0);
  assert.equal(clinic.confirmPrescription(clinic.emptyState(), { medications: [{ strength: "20 mg" }] }).reason, "empty");
});

test("sample orders show a due reminder and a refill on the calendar", function () {
  var today = "2026-11-18";
  var state = clinic.sampleState(today, sellers.list());
  var notes = clinic.reminders(state, today).filter(function (note) { return !note.read; });
  assert.equal(notes.length, 1);
  assert.match(notes[0].message, /Atorvastatin 20 mg/);
  assert.match(notes[0].message, /place another order/);
  var dismissed = clinic.reminders(clinic.markNotificationRead(state, notes[0].id), today);
  assert.equal(dismissed[0].read, true);

  var december = clinic.calendar(state, 2026, 12).filter(function (cell) {
    return cell.inMonth && cell.refills.length;
  });
  assert.equal(december.length, 1);
  assert.equal(december[0].refills[0].name, "Atorvastatin");
  var upcoming = clinic.upcomingRefills(state, today);
  assert.equal(upcoming.length, 2);
  assert.equal(upcoming[0].name, "Atorvastatin");
  assert.equal(state.orders.filter(function (order) { return order.status === "fulfilled" && !order.rating; }).length, 1);
});

test("ranking assigns a seller when the patient does not pick one", function () {
  var placed = clinic.placeOrder(clinic.emptyState(), {
    name: "Metformin",
    strength: "500 mg",
    orderedAt: "2026-11-18"
  }, { sellers: sellers.list(), random: function () { return 0; } });
  assert.equal(placed.order.sellerId, "apollo");
  assert.equal(placed.order.supplyDays, 60);
  assert.equal(placed.order.leadDays, 20);
});
