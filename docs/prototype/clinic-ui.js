// Browser wiring for prescriptions, refills, and seller ratings.
// The decisions live in extract.js, refill.js, ranking.js, and clinic.js.

(function () {
  var clinic = window.MedFinderClinic;
  var refill = window.MedFinderRefill;
  var ranking = window.MedFinderRanking;
  var sellers = window.MedFinderSellers;
  var STORAGE_KEY = "medfinder-clinic-v1";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var state = loadState();
  var draft = [];
  var draftFile = "";
  var today = todayIso();
  var view = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  var reading = false;

  function loadState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
      if (!parsed || !parsed.patient || !Array.isArray(parsed.orders) || !Array.isArray(parsed.prescriptions)) {
        return clinic.emptyState();
      }
      if (!Array.isArray(parsed.readNotificationIds)) parsed.readNotificationIds = [];
      return parsed;
    } catch (error) {
      return clinic.emptyState();
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      setMessage("order-message", "This browser did not keep the saved data.");
    }
  }

  function todayIso() {
    var now = new Date();
    var month = now.getMonth() + 1;
    var day = now.getDate();
    return now.getFullYear() + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function track(eventName, properties) {
    if (window.posthog && typeof window.posthog.capture === "function") {
      window.posthog.capture(eventName, properties || {});
    }
  }

  function setMessage(id, text) {
    var node = document.getElementById(id);
    if (node) node.textContent = text || "";
  }

  function blankMed() {
    return { name: "", strength: "", frequency: "", quantity: "", supplyDays: refill.DEFAULT_SUPPLY_DAYS };
  }

  function readReview() {
    return Array.prototype.map.call(document.querySelectorAll(".rx-med"), function (row) {
      return {
        name: row.querySelector("[data-field='name']").value,
        strength: row.querySelector("[data-field='strength']").value,
        frequency: row.querySelector("[data-field='frequency']").value,
        quantity: row.querySelector("[data-field='quantity']").value,
        supplyDays: row.querySelector("[data-field='supply']").value
      };
    });
  }

  function showReview(medications, filename) {
    draft = (medications || []).map(function (med) {
      return {
        name: med.name || "",
        strength: med.strength || "",
        frequency: med.frequency || "",
        quantity: med.quantity || "",
        supplyDays: med.supplyDays || refill.DEFAULT_SUPPLY_DAYS
      };
    });
    if (!draft.length) draft = [blankMed()];
    draftFile = filename || "";
    document.getElementById("rx-review").hidden = false;
    renderReview();
  }

  function renderReview() {
    var box = document.getElementById("rx-meds");
    box.innerHTML = draft.map(function (med, index) {
      return "<div class='rx-med price-card'>" +
        "<div class='fields fields-med'>" +
          field("Medication", "name", med.name, "Drug name") +
          field("Strength", "strength", med.strength, "20 mg") +
          field("Frequency", "frequency", med.frequency, "once daily") +
          field("Quantity", "quantity", med.quantity, "60 tablets") +
          field("Supply days", "supply", med.supplyDays, "60", "number") +
        "</div>" +
        "<button type='button' data-remove='" + index + "'>Remove</button>" +
      "</div>";
    }).join("");
  }

  function field(label, name, value, placeholder, type) {
    return "<div><label>" + label + "<input data-field='" + name + "' type='" + (type || "text") +
      "' value='" + escapeHtml(value) + "' placeholder='" + escapeHtml(placeholder) + "' /></label></div>";
  }

  function fileToPayload(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result || "");
        var comma = dataUrl.indexOf(",");
        resolve({
          filename: file.name,
          mimeType: file.type || "",
          dataBase64: comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
        });
      };
      reader.onerror = function () { reject(new Error("read")); };
      reader.readAsDataURL(file);
    });
  }

  function savedMedications() {
    var list = [];
    state.prescriptions.forEach(function (prescription) {
      prescription.medications.forEach(function (med, index) {
        list.push({ prescriptionId: prescription.id, index: index, med: med });
      });
    });
    return list;
  }

  function rankedSellers() {
    return ranking.orderShares(clinic.projectSellers(sellers.list(), state.orders));
  }

  function renderSaved() {
    var box = document.getElementById("saved-list");
    if (!state.prescriptions.length) {
      box.innerHTML = "<p class='hint'>No prescription is saved yet.</p>";
      return;
    }
    box.innerHTML = state.prescriptions.map(function (prescription) {
      var items = prescription.medications.map(function (med) {
        return "<li>" + escapeHtml(med.name) +
          (med.strength ? " · " + escapeHtml(med.strength) : "") +
          (med.frequency ? " · " + escapeHtml(med.frequency) : "") +
          (med.quantity ? " · " + escapeHtml(med.quantity) : "") +
          " · " + escapeHtml(med.supplyDays) + "-day supply</li>";
      }).join("");
      var title = prescription.sourceFileName || "Entered by hand";
      return "<div class='price-card'><p><strong>" + escapeHtml(title) + "</strong>" +
        (prescription.savedAt ? " · saved " + escapeHtml(prescription.savedAt) : "") +
        "</p><ul>" + items + "</ul></div>";
    }).join("");
  }

  function renderOrderForm() {
    var meds = savedMedications();
    var medSelect = document.getElementById("order-med");
    var previous = medSelect.value;
    medSelect.innerHTML = meds.map(function (item, index) {
      var med = item.med;
      var label = med.name + (med.strength ? " " + med.strength : "");
      return "<option value='" + index + "'>" + escapeHtml(label) + "</option>";
    }).join("");
    if (previous && medSelect.querySelector("option[value='" + previous + "']")) medSelect.value = previous;
    var sellerSelect = document.getElementById("order-seller");
    var previousSeller = sellerSelect.value;
    sellerSelect.innerHTML = rankedSellers().map(function (seller, index) {
      return "<option value='" + escapeHtml(seller.id) + "'>" + (index + 1) + ". " + escapeHtml(seller.name) + "</option>";
    }).join("");
    if (previousSeller && sellerSelect.querySelector("option[value='" + previousSeller + "']")) sellerSelect.value = previousSeller;
    var supply = document.getElementById("order-supply");
    var selected = meds[Number(medSelect.value)];
    if (selected && document.activeElement !== supply) supply.value = selected.med.supplyDays;
    document.getElementById("order-place").disabled = meds.length === 0;
    document.getElementById("order-assign").disabled = meds.length === 0;
  }

  function renderOrders() {
    var box = document.getElementById("order-list");
    if (!state.orders.length) {
      box.innerHTML = "<p class='hint'>No order yet. Save a prescription, then place an order to put a refill on the calendar.</p>";
      return;
    }
    box.innerHTML = state.orders.slice().reverse().map(function (order) {
      var rating = "";
      if (order.rating) {
        rating = "<p>Your rating: " + order.rating.stars + " of 5" +
          (order.rating.comment ? " · " + escapeHtml(order.rating.comment) : "") + "</p>";
      } else if (order.status === "fulfilled") {
        rating = "<div class='row-actions'>" +
          "<label>Stars <select data-stars='" + escapeHtml(order.id) + "'>" +
            "<option value='5'>5</option><option value='4'>4</option><option value='3'>3</option><option value='2'>2</option><option value='1'>1</option>" +
          "</select></label>" +
          "<label>Comment <input data-comment='" + escapeHtml(order.id) + "' placeholder='Optional' /></label>" +
          "<button type='button' data-rate='" + escapeHtml(order.id) + "'>Save rating</button>" +
        "</div>";
      }
      var fulfill = order.status === "fulfilled"
        ? "<p>Fulfilled" + (order.fulfilledAt ? " " + escapeHtml(order.fulfilledAt) : "") + "</p>"
        : "<button type='button' data-fulfill='" + escapeHtml(order.id) + "'>Mark fulfilled</button>";
      return "<div class='price-card'>" +
        "<p><strong>" + escapeHtml(order.name) + (order.strength ? " " + escapeHtml(order.strength) : "") + "</strong> · " +
          escapeHtml(order.sellerName) + "</p>" +
        "<p>Ordered " + escapeHtml(order.orderedAt) + " · " + escapeHtml(order.supplyDays) + "-day supply · reminder " +
          escapeHtml(order.reminderOn) + "</p>" +
        "<p>Next refill " + escapeHtml(order.refillDueOn) + "</p>" +
        fulfill + rating +
      "</div>";
    }).join("");
  }

  function renderReminders() {
    var notes = clinic.reminders(state, today);
    var open = notes.filter(function (note) { return !note.read; });
    var box = document.getElementById("reminder-list");
    if (!open.length) {
      box.innerHTML = "<p class='hint'>No reminder is due. A reminder appears " + refill.DEFAULT_LEAD_DAYS +
        " days before a refill, unless that order uses a different lead time.</p>";
      return;
    }
    box.innerHTML = open.map(function (note) {
      return "<div class='notice'><p>" + escapeHtml(note.message) + "</p>" +
        "<button type='button' data-dismiss='" + escapeHtml(note.id) + "'>Dismiss</button></div>";
    }).join("");
  }

  function renderCalendar() {
    document.getElementById("cal-label").textContent = MONTHS[view.month - 1] + " " + view.year;
    var cells = clinic.calendar(state, view.year, view.month);
    var heads = refill.WEEKDAYS.map(function (day) {
      return "<div class='cal-head'>" + day + "</div>";
    }).join("");
    document.getElementById("cal-grid").innerHTML = heads + cells.map(function (cell) {
      var marks = cell.refills.map(function (item) {
        return "<span class='cal-mark'>" + escapeHtml(item.name) + "</span>";
      }).join("");
      var classes = "cal-day" + (cell.inMonth ? "" : " out") + (cell.refills.length ? " due" : "");
      return "<div class='" + classes + "'><strong>" + Number(cell.date.slice(8)) + "</strong>" + marks + "</div>";
    }).join("");
    var upcoming = clinic.upcomingRefills(state, today);
    var list = document.getElementById("cal-list");
    if (!upcoming.length) {
      list.innerHTML = "<li>No refill is scheduled.</li>";
      return;
    }
    list.innerHTML = upcoming.map(function (item) {
      var label = item.status === "overdue" ? "Overdue" : item.status === "due_soon" ? "Reminder open" : "Scheduled";
      return "<li><strong>" + escapeHtml(item.refillDueOn) + "</strong> · " + escapeHtml(item.name) +
        (item.strength ? " " + escapeHtml(item.strength) : "") + " · " + label +
        " · remind " + escapeHtml(item.reminderOn) + " · " + escapeHtml(item.sellerName) + "</li>";
    }).join("");
  }

  function renderSellers() {
    var board = rankedSellers();
    document.getElementById("seller-list").innerHTML = board.map(function (seller, index) {
      var raw = seller.rawAverage == null ? "no reviews yet" : "raw average " + seller.rawAverage.toFixed(2);
      return "<div class='price-card'>" +
        "<p><strong>" + (index + 1) + ". " + escapeHtml(seller.name) + "</strong> · " + escapeHtml(seller.city) + "</p>" +
        "<p>Smoothed rating " + seller.ratingAverage.toFixed(2) + " / 5 from " + seller.ratingCount +
          " rating" + (seller.ratingCount === 1 ? "" : "s") + " (" + raw + ")</p>" +
        "<p>Fulfilled " + seller.fulfilledCount + " of " + seller.assignedCount +
          " assigned · reliability " + Math.round(seller.reliability * 100) + "%</p>" +
        "<p>Ranking score " + seller.rankingScore.toFixed(3) +
          " · about " + (seller.share * 100).toFixed(1) + " of every 100 assigned orders</p>" +
        (seller.note ? "<p class='hint'>" + escapeHtml(seller.note) + "</p>" : "") +
      "</div>";
    }).join("");
  }

  function renderAll() {
    var nameInput = document.getElementById("patient-name");
    if (document.activeElement !== nameInput) nameInput.value = state.patient.name;
    renderSaved();
    renderOrderForm();
    renderOrders();
    renderReminders();
    renderCalendar();
    renderSellers();
  }

  function selectedMedication() {
    var meds = savedMedications();
    var index = Number(document.getElementById("order-med").value);
    return meds[index] || null;
  }

  function orderInput(sellerId) {
    var selected = selectedMedication();
    if (!selected) return null;
    var med = selected.med;
    var input = {
      name: med.name,
      strength: med.strength,
      frequency: med.frequency,
      quantity: med.quantity,
      supplyDays: document.getElementById("order-supply").value,
      leadDays: document.getElementById("order-lead").value,
      orderedAt: today,
      prescriptionId: selected.prescriptionId,
      form: "tablet",
      release: "IR"
    };
    if (sellerId) {
      input.sellerId = sellerId;
      var seller = rankedSellers().filter(function (item) { return item.id === sellerId; })[0];
      input.sellerName = seller ? seller.name : sellerId;
    }
    return input;
  }

  function place(assign) {
    var input = orderInput(assign ? "" : document.getElementById("order-seller").value);
    if (!input) {
      setMessage("order-message", "Save a prescription before placing an order.");
      return;
    }
    var result = clinic.placeOrder(state, input, {
      sellers: sellers.list(),
      random: Math.random,
      matchDrug: window.MedFinder && window.MedFinder.matchDrug
    });
    setMessage("order-message", result.message);
    if (!result.ok) return;
    state = result.state;
    persist();
    track("placed_order", { seller_id: result.order.sellerId, assigned: assign });
    renderAll();
    setMessage("order-message", result.message + " Refill " + result.order.refillDueOn + ". Reminder " + result.order.reminderOn + ".");
  }

  document.getElementById("rx-read").addEventListener("click", function () {
    if (reading) return;
    var file = document.getElementById("rx-file").files && document.getElementById("rx-file").files[0];
    if (!file) {
      setMessage("rx-message", "Choose a photo or PDF first.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMessage("rx-message", "That file is too large. Upload a photo or PDF under 8 MB.");
      showReview([], file.name);
      return;
    }
    reading = true;
    setMessage("rx-message", "Reading the prescription…");
    track("clicked_read_prescription", { type: file.type || "" });
    fileToPayload(file).then(function (payload) {
      return fetch("/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (response) {
        return response.json();
      });
    }).then(function (result) {
      var message = (result && result.message) || "This file could not be used as a prescription.";
      if (result && result.costUsd != null) message += " This read cost $" + Number(result.costUsd).toFixed(4) + ".";
      setMessage("rx-message", message);
      if (result && result.status === "ok") showReview(result.medications, file.name);
      else showReview([], file.name);
    }).catch(function () {
      setMessage("rx-message", "The local server is not running, so the file could not be read. Enter the medicine by hand, or start node server.js.");
      showReview([], file.name);
    }).then(function () {
      reading = false;
    });
  });

  document.getElementById("rx-manual").addEventListener("click", function () {
    setMessage("rx-message", "Enter the medicine, check it, then save.");
    showReview([blankMed()], "");
  });

  document.getElementById("rx-meds").addEventListener("click", function (event) {
    var remove = event.target.getAttribute("data-remove");
    if (remove == null) return;
    draft = readReview();
    draft.splice(Number(remove), 1);
    if (!draft.length) draft = [blankMed()];
    renderReview();
  });

  document.getElementById("rx-add").addEventListener("click", function () {
    draft = readReview().concat([blankMed()]);
    renderReview();
  });

  document.getElementById("rx-save").addEventListener("click", function () {
    var result = clinic.confirmPrescription(state, {
      sourceFileName: draftFile,
      savedAt: today,
      medications: readReview()
    });
    setMessage("rx-message", result.message);
    if (!result.ok) return;
    state = result.state;
    persist();
    track("saved_prescription", { count: result.prescription.medications.length });
    renderAll();
  });

  document.getElementById("order-med").addEventListener("change", function () {
    var selected = selectedMedication();
    if (selected && selected.med.supplyDays) document.getElementById("order-supply").value = selected.med.supplyDays;
  });

  document.getElementById("order-place").addEventListener("click", function () { place(false); });
  document.getElementById("order-assign").addEventListener("click", function () { place(true); });

  document.getElementById("order-list").addEventListener("click", function (event) {
    var fulfillId = event.target.getAttribute("data-fulfill");
    if (fulfillId) {
      var fulfilled = clinic.fulfillOrder(state, fulfillId, today);
      if (!fulfilled.ok) {
        setMessage("order-message", fulfilled.message);
        return;
      }
      state = fulfilled.state;
      persist();
      renderAll();
      setMessage("order-message", "Order marked fulfilled. You can rate that seller once.");
      return;
    }
    var rateId = event.target.getAttribute("data-rate");
    if (!rateId) return;
    var stars = document.querySelector("[data-stars='" + rateId + "']");
    var comment = document.querySelector("[data-comment='" + rateId + "']");
    var rated = clinic.rateOrder(state, rateId, {
      stars: stars ? stars.value : "",
      comment: comment ? comment.value : "",
      ratedAt: today
    });
    setMessage("order-message", rated.message);
    if (!rated.ok) return;
    state = rated.state;
    persist();
    track("rated_seller", { stars: rated.order.rating.stars });
    renderAll();
  });

  document.getElementById("reminder-list").addEventListener("click", function (event) {
    var id = event.target.getAttribute("data-dismiss");
    if (!id) return;
    state = clinic.markNotificationRead(state, id);
    persist();
    renderReminders();
  });

  document.getElementById("cal-prev").addEventListener("click", function () {
    view.month -= 1;
    if (view.month < 1) { view.month = 12; view.year -= 1; }
    renderCalendar();
  });
  document.getElementById("cal-next").addEventListener("click", function () {
    view.month += 1;
    if (view.month > 12) { view.month = 1; view.year += 1; }
    renderCalendar();
  });

  document.getElementById("patient-name").addEventListener("change", function () {
    state = clinic.renamePatient(state, document.getElementById("patient-name").value);
    persist();
  });

  document.getElementById("load-sample").addEventListener("click", function () {
    state = clinic.sampleState(today, sellers.list());
    persist();
    renderAll();
    setMessage("order-message", "Sample orders loaded. Atorvastatin is inside its reminder window, and metformin can be rated.");
  });

  document.getElementById("clear-clinic").addEventListener("click", function () {
    state = clinic.emptyState();
    persist();
    renderAll();
    setMessage("order-message", "Saved prescriptions and orders were cleared from this browser. Seller history is the demo seed.");
  });

  renderAll();
})();
