// Patient, prescription, and order records for the local demo.
// One patient lives in this browser. There is no account server.

(function (root, factory) {
  var refill = null;
  var ranking = null;
  if (typeof require === "function") {
    refill = require("./refill.js");
    ranking = require("./ranking.js");
  } else if (root) {
    refill = root.MedFinderRefill;
    ranking = root.MedFinderRanking;
  }
  var api = factory(refill, ranking);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MedFinderClinic = api;
})(typeof window !== "undefined" ? window : null, function (refill, ranking) {
  function emptyState() {
    return {
      patient: { id: "demo-patient", name: "Demo patient" },
      prescriptions: [],
      orders: [],
      readNotificationIds: []
    };
  }

  function clone(state) {
    var source = state && state.patient ? state : emptyState();
    return {
      patient: {
        id: source.patient.id || "demo-patient",
        name: source.patient.name || "Demo patient"
      },
      prescriptions: (source.prescriptions || []).slice(),
      orders: (source.orders || []).slice(),
      readNotificationIds: (source.readNotificationIds || []).slice()
    };
  }

  function fail(state, reason, message) {
    return { ok: false, reason: reason, message: message, state: state };
  }

  function clean(value, limit) {
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, limit);
  }

  function nextId(options, prefix) {
    if (options && typeof options.id === "function") return options.id(prefix);
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function wholeDays(value) {
    var number = Number(value);
    if (!isFinite(number) || Math.floor(number) !== number || number <= 0 || number > 365) return null;
    return number;
  }

  function normalizeSavedMed(row) {
    if (!row || typeof row !== "object") return null;
    var name = clean(row.name, 120);
    if (!name) return null;
    return {
      name: name,
      strength: clean(row.strength, 80),
      form: clean(row.form, 40),
      release: clean(row.release, 40),
      frequency: clean(row.frequency, 80),
      quantity: clean(row.quantity, 80),
      supplyDays: wholeDays(row.supplyDays) || refill.DEFAULT_SUPPLY_DAYS
    };
  }

  function confirmPrescription(state, input, options) {
    var meds = ((input && input.medications) || []).map(normalizeSavedMed).filter(Boolean).slice(0, 12);
    if (!meds.length) {
      return fail(state, "empty", "Add at least one medication name before saving.");
    }
    var next = clone(state);
    var prescription = {
      id: nextId(options, "rx"),
      patientId: next.patient.id,
      sourceFileName: clean(input && input.sourceFileName, 180),
      savedAt: clean(input && input.savedAt, 40),
      medications: meds
    };
    next.prescriptions = next.prescriptions.concat([prescription]);
    return { ok: true, state: next, prescription: prescription, message: "Prescription saved." };
  }

  function findSeller(sellers, sellerId) {
    var found = null;
    (sellers || []).forEach(function (seller) {
      if (seller && seller.id === sellerId) found = seller;
    });
    return found;
  }

  function placeOrder(state, input, options) {
    var opts = options || {};
    var name = clean(input && input.name, 120);
    if (!name) return fail(state, "empty", "Enter a medication name.");
    if (typeof opts.matchDrug === "function") {
      var verdict = opts.matchDrug({
        name: name,
        strength: input.strength || "",
        form: input.form || "tablet",
        release: input.release || "IR"
      });
      if (verdict && verdict.status === "blocked") {
        return fail(state, "blocked", verdict.message || "MedFinder does not place an order for this medicine.");
      }
    }
    var schedule = refill.schedule(input && input.orderedAt, input && input.supplyDays, input && input.leadDays);
    if (!schedule.ok) return fail(state, schedule.reason, schedule.message);

    var seller = null;
    if (input && input.sellerId) {
      seller = findSeller(opts.sellers, input.sellerId) || {
        id: input.sellerId,
        name: clean(input.sellerName, 120) || input.sellerId
      };
    } else {
      seller = ranking.assignSeller(opts.sellers || [], opts.random);
      if (!seller) return fail(state, "no_seller", "There is no seller to assign.");
    }

    var next = clone(state);
    var order = {
      id: nextId(opts, "order"),
      patientId: next.patient.id,
      prescriptionId: clean(input.prescriptionId, 80),
      sellerId: seller.id,
      sellerName: seller.name || seller.id,
      name: name,
      strength: clean(input.strength, 80),
      frequency: clean(input.frequency, 80),
      quantity: clean(input.quantity, 80),
      form: clean(input.form, 40),
      release: clean(input.release, 40),
      supplyDays: schedule.supplyDays,
      leadDays: schedule.leadDays,
      orderedAt: input.orderedAt,
      refillDueOn: schedule.refillDueOn,
      reminderOn: schedule.reminderOn,
      status: "placed",
      fulfilledAt: "",
      rating: null
    };
    next.orders = next.orders.concat([order]);
    return { ok: true, state: next, order: order, message: "Order placed with " + order.sellerName + "." };
  }

  function replaceOrder(state, orderId, change) {
    var next = clone(state);
    var index = -1;
    next.orders.forEach(function (order, orderIndex) {
      if (order.id === orderId) index = orderIndex;
    });
    if (index < 0) return null;
    var order = Object.assign({}, next.orders[index]);
    change(order);
    next.orders[index] = order;
    return { state: next, order: order };
  }

  function fulfillOrder(state, orderId, fulfilledAt) {
    var replaced = replaceOrder(state, orderId, function (order) {
      if (order.status !== "fulfilled") {
        order.status = "fulfilled";
        order.fulfilledAt = clean(fulfilledAt, 40);
      }
    });
    if (!replaced) return fail(state, "missing", "That order was not found.");
    return { ok: true, state: replaced.state, order: replaced.order, message: "Order marked fulfilled." };
  }

  function rateOrder(state, orderId, input) {
    var stars = Number(input && input.stars);
    if (!isFinite(stars) || Math.floor(stars) !== stars || stars < 1 || stars > 5) {
      return fail(state, "bad_stars", "Choose a rating from 1 to 5 stars.");
    }
    var blocked = null;
    var replaced = replaceOrder(state, orderId, function (order) {
      if (order.status !== "fulfilled") {
        blocked = fail(state, "not_fulfilled", "Rate a seller after the order is fulfilled.");
        return;
      }
      if (order.rating) {
        blocked = fail(state, "already_rated", "This order already has a rating.");
        return;
      }
      order.rating = {
        stars: stars,
        comment: clean(input && input.comment, 500),
        ratedAt: clean(input && input.ratedAt, 40)
      };
    });
    if (!replaced) return fail(state, "missing", "That order was not found.");
    if (blocked) return blocked;
    return { ok: true, state: replaced.state, order: replaced.order, message: "Rating saved." };
  }

  function medicationKey(order) {
    return String(order.name || "").trim().toLowerCase() + "|" + String(order.strength || "").trim().toLowerCase();
  }

  function activeOrders(orders) {
    var latest = {};
    (orders || []).forEach(function (order) {
      var key = medicationKey(order);
      var current = latest[key];
      if (!current || order.orderedAt > current.orderedAt || (order.orderedAt === current.orderedAt && String(order.id) > String(current.id))) {
        latest[key] = order;
      }
    });
    return Object.keys(latest).map(function (key) { return latest[key]; });
  }

  function reminderText(order, today) {
    var label = order.name + (order.strength ? " " + order.strength : "");
    if (today > order.refillDueOn) {
      return "The refill for " + label + " was due on " + order.refillDueOn + ". It's time to place another order.";
    }
    return "It's time to place another order for " + label + ". The refill is due on " + order.refillDueOn + ".";
  }

  function reminders(state, today) {
    if (!refill.parseIsoDate(today)) return [];
    var read = {};
    ((state && state.readNotificationIds) || []).forEach(function (id) { read[id] = true; });
    return activeOrders(state && state.orders).filter(function (order) {
      return order.reminderOn && today >= order.reminderOn;
    }).map(function (order) {
      var id = "reminder:" + order.id;
      return {
        id: id,
        orderId: order.id,
        message: reminderText(order, today),
        reminderOn: order.reminderOn,
        refillDueOn: order.refillDueOn,
        read: !!read[id]
      };
    }).sort(function (left, right) {
      return left.refillDueOn < right.refillDueOn ? -1 : left.refillDueOn > right.refillDueOn ? 1 : 0;
    });
  }

  function markNotificationRead(state, id) {
    var next = clone(state);
    if (id && next.readNotificationIds.indexOf(id) === -1) next.readNotificationIds.push(id);
    return next;
  }

  function renamePatient(state, name) {
    var next = clone(state);
    next.patient.name = clean(name, 80) || "Demo patient";
    return next;
  }

  function projectSellers(sellers, orders) {
    return (sellers || []).map(function (seller) {
      var ratings = (seller.ratings || []).slice();
      var assigned = Number(seller.assignedCount) || 0;
      var fulfilled = Number(seller.fulfilledCount) || 0;
      (orders || []).forEach(function (order) {
        if (!order || order.sellerId !== seller.id) return;
        assigned += 1;
        if (order.status === "fulfilled") fulfilled += 1;
        if (order.rating) ratings.push(order.rating);
      });
      return {
        id: seller.id,
        name: seller.name,
        city: seller.city || "",
        note: seller.note || "",
        ratings: ratings,
        assignedCount: assigned,
        fulfilledCount: fulfilled
      };
    });
  }

  function calendar(state, year, month) {
    var marks = {};
    activeOrders(state && state.orders).forEach(function (order) {
      if (!order.refillDueOn) return;
      if (!marks[order.refillDueOn]) marks[order.refillDueOn] = [];
      marks[order.refillDueOn].push({
        orderId: order.id,
        name: order.name,
        strength: order.strength || ""
      });
    });
    return refill.monthCells(year, month, marks);
  }

  function upcomingRefills(state, today) {
    return activeOrders(state && state.orders).map(function (order) {
      var status = "scheduled";
      if (today && order.refillDueOn < today) status = "overdue";
      else if (today && order.reminderOn && today >= order.reminderOn) status = "due_soon";
      return {
        orderId: order.id,
        name: order.name,
        strength: order.strength,
        sellerName: order.sellerName,
        orderedAt: order.orderedAt,
        refillDueOn: order.refillDueOn,
        reminderOn: order.reminderOn,
        supplyDays: order.supplyDays,
        leadDays: order.leadDays,
        status: status
      };
    }).sort(function (left, right) {
      return left.refillDueOn < right.refillDueOn ? -1 : left.refillDueOn > right.refillDueOn ? 1 : 0;
    });
  }

  function sampleState(today, sellers) {
    var counter = 0;
    var ids = function (prefix) {
      counter += 1;
      return prefix + "-sample-" + counter;
    };
    var options = { id: ids };
    var saved = confirmPrescription(emptyState(), {
      sourceFileName: "sample-prescription.pdf",
      savedAt: today,
      medications: [
        { name: "Atorvastatin", strength: "20 mg", frequency: "once daily", quantity: "60 tablets", supplyDays: 60 },
        { name: "Metformin", strength: "500 mg", frequency: "twice daily", quantity: "120 tablets", supplyDays: 60 }
      ]
    }, options);
    var firstSeller = (sellers && sellers[0]) || { id: "apollo", name: "Apollo Pharmacy" };
    var secondSeller = (sellers && sellers[1]) || { id: "netmeds", name: "Netmeds" };
    var first = placeOrder(saved.state, {
      name: "Atorvastatin",
      strength: "20 mg",
      frequency: "once daily",
      quantity: "60 tablets",
      supplyDays: 60,
      leadDays: 20,
      orderedAt: refill.addDays(today, -45),
      sellerId: firstSeller.id,
      sellerName: firstSeller.name,
      prescriptionId: saved.prescription.id
    }, options);
    var second = placeOrder(first.state, {
      name: "Metformin",
      strength: "500 mg",
      frequency: "twice daily",
      quantity: "120 tablets",
      supplyDays: 60,
      leadDays: 20,
      orderedAt: refill.addDays(today, -10),
      sellerId: secondSeller.id,
      sellerName: secondSeller.name,
      prescriptionId: saved.prescription.id
    }, options);
    return fulfillOrder(second.state, second.order.id, refill.addDays(today, -8)).state;
  }

  return {
    emptyState: emptyState,
    confirmPrescription: confirmPrescription,
    placeOrder: placeOrder,
    fulfillOrder: fulfillOrder,
    rateOrder: rateOrder,
    activeOrders: activeOrders,
    reminders: reminders,
    markNotificationRead: markNotificationRead,
    renamePatient: renamePatient,
    projectSellers: projectSellers,
    calendar: calendar,
    upcomingRefills: upcomingRefills,
    sampleState: sampleState
  };
});
