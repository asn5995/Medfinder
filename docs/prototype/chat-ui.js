// The chat screen. This file only draws and wires things.
// The decisions live in chat.js (questions and the checks on what the model returns),
// match.js (every match), and clinic.js, refill.js, and ranking.js (saved records).
// The model is called only by the server, through POST /chat and POST /extract.

(function () {
  var chat = window.MedFinderChat;
  var clinic = window.MedFinderClinic;
  var refill = window.MedFinderRefill;
  var ranking = window.MedFinderRanking;
  var sellers = window.MedFinderSellers;
  var match = window.MedFinder;
  var lookup = window.MedFinderLookup;
  // config.js picks the server: this one, or the Render service when the page is on GitHub Pages.
  var api = window.medfinderApi || function (path) { return path; };
  var remoteServer = !!window.MEDFINDER_API_BASE;
  var STORAGE_KEY = "medfinder-clinic-v1";
  var MAX_FILE = 8 * 1024 * 1024;
  var SAMPLES = [
    { label: "Lipitor 20 mg", name: "Lipitor", strength: "20 mg", form: "tablet", release: "IR" },
    { label: "Synthroid 50 mcg", name: "Synthroid", strength: "50 mcg", form: "tablet", release: "IR" },
    { label: "Lipitor 40 mg", name: "Lipitor", strength: "40 mg", form: "tablet", release: "IR" },
    { label: "Metoprolol succinate ER", name: "Metoprolol succinate", strength: "50 mg", form: "tablet", release: "ER" },
    { label: "Adderall", name: "Adderall", strength: "20 mg", form: "tablet", release: "IR" }
  ];

  var logBox = document.getElementById("log");
  var thread = document.getElementById("thread");
  var composer = document.getElementById("composer");
  var input = document.getElementById("message");
  var sendButton = document.getElementById("send");
  var fileInput = document.getElementById("file");
  var panel = document.getElementById("panel");
  var about = document.getElementById("about");

  var state = loadState();
  var today = todayIso();
  var online = null;
  var session = freshSession();

  // ---------- small helpers ----------

  function freshSession() {
    return {
      draft: chat.emptyDraft(),
      asked: "",
      history: [],
      queue: [],
      fileName: "",
      mode: "intake",
      save: null,
      busy: false
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function track(eventName, properties) {
    if (window.posthog && typeof window.posthog.capture === "function") {
      window.posthog.capture(eventName, properties || {});
    }
  }

  function todayIso() {
    var now = new Date();
    var month = now.getMonth() + 1;
    var day = now.getDate();
    return now.getFullYear() + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
  }

  function niceDate(iso) {
    var date = new Date(String(iso) + "T00:00:00");
    if (isNaN(date.getTime())) return String(iso || "");
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function medLabel(med) {
    return [med.name, med.strength, med.form].filter(Boolean).join(" ");
  }

  // ---------- saved records (this browser only) ----------

  function loadState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
      if (!parsed || !parsed.patient || !Array.isArray(parsed.orders) || !Array.isArray(parsed.prescriptions)) return clinic.emptyState();
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
      bot("This browser did not keep the saved data. It will be gone when you close the page.");
    }
  }

  // Copies a confirmed text record to the server database when one is set up. Files are never sent.
  function mirror(kind, record) {
    if (!record || online !== true) return;
    var copy = JSON.parse(JSON.stringify(record));
    delete copy.dataBase64;
    delete copy.file;
    fetch(api("/records"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: kind, record: copy })
    }).catch(function () {});
  }

  function rankedSellers() {
    return ranking.orderShares(clinic.projectSellers(sellers.list(), state.orders));
  }

  // ---------- messages ----------

  function scrollDown() {
    logBox.scrollTop = logBox.scrollHeight;
  }

  function retireChoices() {
    Array.prototype.forEach.call(thread.querySelectorAll(".choices button"), function (button) {
      button.disabled = true;
    });
  }

  function addMessage(kind, content, choices) {
    retireChoices();
    var row = el("div", "msg " + kind);
    var bubble = el("div", "bubble");
    if (typeof content === "string") bubble.textContent = content;
    else bubble.appendChild(content);
    row.appendChild(bubble);
    if (choices && choices.length) row.appendChild(choiceRow(choices));
    thread.appendChild(row);
    scrollDown();
    return row;
  }

  function bot(text, choices) {
    session.history.push({ role: "assistant", content: text });
    return addMessage("bot", text, choices);
  }

  function me(text) {
    return addMessage("user", text);
  }

  function card(node, choices) {
    return addMessage("bot card", node, choices);
  }

  function choiceRow(choices) {
    var row = el("div", "choices");
    choices.forEach(function (choice) {
      var button = el("button", choice.primary ? "primary" : "", choice.label);
      button.type = "button";
      // A "keep" button only opens something (a panel, the file picker), so the others stay usable.
      button.addEventListener("click", function () {
        if (button.disabled || session.busy) return;
        if (!choice.keep) button.classList.add("chosen");
        choice.onClick();
      });
      row.appendChild(button);
    });
    return row;
  }

  function typing(text) {
    var row = addMessage("bot typing", text || "Thinking…");
    row.setAttribute("aria-busy", "true");
    return function () { if (row.parentNode) row.parentNode.removeChild(row); };
  }

  function setBusy(busy) {
    session.busy = busy;
    sendButton.disabled = busy;
  }

  // ---------- the intake conversation ----------

  function offlineText() {
    if (keyMissing) return keyMissingText();
    if (location.protocol === "file:") {
      return "This page was opened from a file, so it can't reach the MedFinder server. Run node server.js and open http://127.0.0.1:8787/prototype/. You can still try a sample medicine below.";
    }
    if (remoteServer) {
      return "I couldn't reach the MedFinder server. It may still be starting up, which can take about a minute. Tap Try again, or try a sample medicine below. Samples use the sample catalog and the same match rules.";
    }
    return "The MedFinder server isn't answering. Check that node server.js is running, then tap Try again. You can still try a sample medicine below.";
  }

  function offlineChoices() {
    return [{ label: "Try again", primary: true, onClick: function () { me("Try again"); reconnect(); } }].concat(sampleChoices());
  }

  function sampleChoices() {
    return SAMPLES.map(function (sample) {
      return {
        label: sample.label,
        onClick: function () {
          me(sample.label);
          track("clicked_example", { drug_name: sample.name, strength: sample.strength });
          session = freshSession();
          session.draft = chat.normalizeDraft(sample);
          showSummary();
        }
      };
    });
  }

  function showSamples() {
    bot("Pick a sample. Samples use the sample catalog, not live listings.", sampleChoices());
  }

  function fieldChoices(field) {
    if (field === "name") {
      var choices = [];
      if (online !== false) choices.push({ label: "📎 Attach a prescription", keep: true, onClick: function () { fileInput.click(); } });
      choices.push({ label: "Try a sample", onClick: function () { me("Try a sample"); showSamples(); } });
      return choices;
    }
    return chat.askFor(field).choices.map(function (choice) {
      return {
        label: choice.label,
        onClick: function () {
          me(choice.label);
          session.history.push({ role: "user", content: choice.label });
          var update = {};
          update[field] = choice.value;
          session.draft = chat.applyUpdates(session.draft, update, "", { trusted: true }).draft;
          continueIntake("");
        }
      };
    });
  }

  function askField(field, reply) {
    var repeat = session.mode === "intake" && session.asked === field;
    session.mode = "intake";
    session.asked = field;
    var text = reply || chat.askFor(field).text;
    // Asked twice and still unknown: point to where the name or strength is printed. No guess.
    if (repeat && (field === "name" || field === "strength")) {
      text += " If you're not sure, it's printed on the prescription and on the pharmacy label on the bottle. You can attach a photo of either.";
    }
    bot(text, fieldChoices(field));
    input.focus();
  }

  // When release is the only gap, RxNorm may answer it: if every listed version at this
  // strength and form is regular (or every one is extended-release), the summary suggests it.
  function trySuggestedRelease() {
    var draft = session.draft;
    return lookup.conceptNames(draft.name).then(function (names) {
      var suggestion = chat.suggestRelease(names, draft.strength, draft.form);
      if (!suggestion) return false;
      session.draft = chat.withSuggestedRelease(draft, suggestion);
      var which = suggestion === "IR" ? "the regular (not extended-release) version" : "an extended-release version";
      bot("RxNorm lists only " + which + " of " + draft.name + " " + draft.strength + " " + draft.form + "s, so I've filled that in. Change it if your label says otherwise.");
      showSummary();
      return true;
    }).catch(function () { return false; });
  }

  function continueIntake(reply) {
    var next = chat.nextMissing(session.draft);
    if (next === "release") {
      setBusy(true);
      return trySuggestedRelease().then(function (used) {
        setBusy(false);
        if (!used) askField("release", reply);
      });
    }
    if (next) return askField(next, reply);
    if (reply && reply.indexOf("?") === -1) bot(reply);
    showSummary();
  }

  function summaryList(rows) {
    var list = el("dl", "facts");
    rows.forEach(function (row) {
      if (!row.value) return;
      list.appendChild(el("dt", "", row.label));
      list.appendChild(el("dd", "", row.value));
    });
    return list;
  }

  function showSummary() {
    session.mode = "confirm_search";
    session.asked = "";
    var rows = chat.summary(session.draft);
    var box = el("div", "summary");
    box.appendChild(el("p", "card-title", "Check these details before I search"));
    box.appendChild(summaryList(rows));
    box.appendChild(el("p", "hint", "Nothing is saved yet."));
    session.history.push({
      role: "assistant",
      content: "Summary to check: " + rows.filter(function (row) { return row.value; }).map(function (row) { return row.label + " " + row.value; }).join(", ") + "."
    });
    card(box, [
      { label: "Search", primary: true, onClick: function () { me("Search"); runSearch(); } },
      { label: "Change something", onClick: function () { me("Change something"); askChange(); } },
      { label: "Start over", onClick: function () { me("Start over"); restart(); } }
    ]);
  }

  function askChange() {
    session.mode = "intake";
    session.asked = "";
    bot("What should I change? Tell me in your own words, for example \"it's 40 mg\" or \"it's a capsule\".");
    input.focus();
  }

  function sendTurn(text) {
    if (online !== true) {
      ensureServer().then(function (up) {
        if (up) sendTurn(text);
        else bot(offlineText(), offlineChoices());
      });
      return;
    }
    var fresh = session.mode === "after_search" || session.mode === "done";
    session.mode = "intake";
    session.history.push({ role: "user", content: text });
    setBusy(true);
    var done = typing();
    fetch(api("/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: session.history.slice(-12), draft: session.draft, asked: session.asked })
    }).then(function (response) {
      return response.json().then(function (body) { return { status: response.status, body: body }; });
    }).then(function (res) {
      done();
      setBusy(false);
      var result = res.body || {};
      if (res.status === 429) {
        session.history.pop();
        bot(result.message || "Too many messages. Wait a few minutes and try again.");
        return;
      }
      if (result.ok !== true) {
        session.history.pop();
        bot(result.message || "The assistant isn't answering right now.", [
          { label: "Try again", primary: true, onClick: function () { me("Try again"); sendTurn(text); } }
        ].concat(sampleChoices()));
        return;
      }
      online = true;
      var draft = result.draft;
      // A new medicine named after a search starts clean, so old details are not carried over.
      if (fresh && result.updates && result.updates.name) {
        draft = chat.applyUpdates(chat.emptyDraft(), result.updates, "", { trusted: true }).draft;
        session.queue = [];
        session.fileName = "";
      }
      session.draft = chat.normalizeDraft(draft);
      track("chat_turn", { intent: result.intent, reply_source: result.replySource });
      if (result.intent === "medical_advice") {
        bot(result.reply);
        continueIntake("");
        return;
      }
      continueIntake(result.reply);
    }).catch(function () {
      done();
      setBusy(false);
      session.history.pop();
      online = false;
      bot(offlineText(), offlineChoices());
    });
  }

  // ---------- prescription upload ----------

  function fileToPayload(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result || "");
        var comma = dataUrl.indexOf(",");
        resolve({ filename: file.name, mimeType: file.type || "", dataBase64: comma === -1 ? dataUrl : dataUrl.slice(comma + 1) });
      };
      reader.onerror = function () { reject(new Error("read")); };
      reader.readAsDataURL(file);
    });
  }

  function readCard(fileName, meds, costUsd) {
    var box = el("div", "summary");
    box.appendChild(el("p", "card-title", "I read this from " + fileName));
    var list = el("ul", "read-list");
    meds.forEach(function (med) {
      var item = el("li");
      item.appendChild(el("strong", "", medLabel(med) + (med.release ? " (" + med.release + ")" : "")));
      var extra = [med.frequency, med.quantity ? "Qty " + med.quantity : ""].filter(Boolean).join(" · ");
      if (extra) item.appendChild(el("span", "hint", " " + extra));
      list.appendChild(item);
    });
    box.appendChild(list);
    box.appendChild(el("p", "hint", "I'll only ask about anything that's missing or unclear. Nothing is saved until you confirm." +
      (costUsd != null ? " This read cost $" + Number(costUsd).toFixed(4) + "." : "")));
    return box;
  }

  function readFile(file) {
    me("📎 " + file.name);
    if (file.size > MAX_FILE) {
      bot("That file is too large. Upload a photo or PDF under 8 MB.");
      return;
    }
    if (online !== true) {
      ensureServer().then(function (up) {
        if (up) sendFile(file);
        else bot(offlineText(), offlineChoices());
      });
      return;
    }
    sendFile(file);
  }

  function sendFile(file) {
    setBusy(true);
    var done = typing("Reading the prescription…");
    track("clicked_read_prescription", { type: file.type || "" });
    fileToPayload(file).then(function (payload) {
      return fetch(api("/extract"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (response) { return response.json(); });
    }).then(function (result) {
      done();
      setBusy(false);
      if (!result || result.status !== "ok" || !result.medications || !result.medications.length) {
        bot((result && result.message) || "That file could not be read as a prescription.", [
          { label: "Type it instead", onClick: function () { me("Type it instead"); askField("name"); } }
        ]);
        return;
      }
      online = true;
      var meds = result.medications.map(chat.fromExtraction);
      session = freshSession();
      session.fileName = file.name;
      session.draft = meds[0];
      session.queue = meds.slice(1);
      card(readCard(file.name, result.medications, result.costUsd));
      session.history.push({ role: "assistant", content: "I read this from the uploaded file: " + result.medications.map(medLabel).join("; ") + "." });
      if (meds.length > 1) bot("I found " + meds.length + " medicines. Let's start with " + medLabel(meds[0]) + ".");
      continueIntake("");
    }).catch(function () {
      done();
      setBusy(false);
      online = false;
      bot("I couldn't reach the MedFinder server, so the file could not be read. " + offlineText(), offlineChoices());
    });
  }

  // ---------- search results ----------

  function formatAmount(amount, currency) {
    var number = Number(amount).toFixed(2);
    if (currency === "USD") return "$" + number;
    if (currency === "INR") return "₹" + number;
    return number + " " + (currency || "");
  }

  function shippingText(row) {
    if (row.shippingKind === "page" && row.cost.shippingIncluded) return "Shipping " + formatAmount(row.cost.shipping, row.currency) + ", as stated on the seller page.";
    if (row.shippingKind === "estimate" && row.cost.shippingIncluded) return "Estimated shipping " + formatAmount(row.cost.shipping, row.currency) + ". " + row.shippingBasis;
    return "Shipping was not stated, so it is not included.";
  }

  function inUsd(row, rate) {
    if (row.currency === "USD") return row.cost.landed;
    if (row.currency === "INR" && rate) return row.cost.landed / rate;
    return null;
  }

  function rxnormText(identity) {
    if (!identity) return "";
    if (identity.error) return "RxNorm lookup failed. No ID was invented.";
    if (!identity.found) return "RxNorm did not return an ID for that name.";
    return "RxNorm: " + identity.name + " (RxCUI " + identity.rxcui + ")";
  }

  function resultCard(result) {
    var box = el("div", "result");
    var head = el("div", "result-head");
    var title = el("p", "result-title");
    var lines = [];
    var details = [];
    var sample = false;

    if (result.kind === "suppliers") {
      box.classList.add("exact");
      var rows = result.filtered.suppliers.slice().sort(function (a, b) { return a.cost.landed - b.cost.landed; });
      var best = rows[0];
      var rate = result.live && result.live.usdInr && result.live.usdInr.rate;
      title.textContent = "✓ Verified in India · " + rows.length + " listing" + (rows.length === 1 ? "" : "s");
      lines.push((best.cost.shippingIncluded ? "From " : "Drug cost from ") + formatAmount(best.cost.landed, best.currency) + " for 90 days (" + best.supplier + ").");
      if (result.us) {
        lines.push("US price " + formatAmount(result.us.cost.landed, "USD") + " for the same " + result.us.cost.units + " units.");
        var bestUsd = inUsd(best, rate);
        if (bestUsd != null) {
          var save = result.us.cost.landed - bestUsd;
          lines.push(save >= 0 ? "About " + formatAmount(save, "USD") + " less than the US price." : "The US price is about " + formatAmount(-save, "USD") + " lower.");
        }
      } else {
        lines.push("No US price for the same strength was found, so savings are not shown.");
      }
      details.push(escapeHtml(result.filtered.message));
      rows.forEach(function (row) {
        details.push("<strong>" + escapeHtml(row.supplier || "Supplier") + "</strong>" + (row.brand ? " · " + escapeHtml(row.brand) : "") + "<br>" +
          escapeHtml(row.ingredient + (row.salt ? " " + row.salt : "") + ", " + match.formatStrength(row.strength) + " " + row.form + ", " + row.release) + "<br>" +
          "Pack of " + row.cost.packCount + " at " + escapeHtml(formatAmount(row.packPrice, row.currency)) + " · " + row.cost.packs + " packs for 90 days<br>" +
          escapeHtml(shippingText(row)) + "<br>" +
          "<a href='" + escapeHtml(row.pageUrl) + "' target='_blank' rel='noopener'>Source page</a>");
      });
      if (result.us) {
        details.push("<strong>United States</strong> · " + escapeHtml(result.us.supplier || "US seller") + " · " +
          "<a href='" + escapeHtml(result.us.pageUrl) + "' target='_blank' rel='noopener'>US source page</a>");
      }
      if (rate) details.push(escapeHtml("Savings use 1 USD = ₹" + Number(rate).toFixed(2) + (result.live.usdInr.date ? " on " + result.live.usdInr.date : "") + "."));
      if (result.live && result.live.costUsd != null) details.push("This lookup cost $" + Number(result.live.costUsd).toFixed(4) + ".");
    } else if (result.kind === "sample") {
      sample = true;
      box.classList.add("exact");
      var product = result.local.product;
      var cost = result.local.cost;
      title.textContent = "✓ Exact match · " + product.brand;
      lines.push("Landed cost " + match.money(cost.landedCents) + " for 90 days, shipping included.");
      lines.push("US price " + match.money(product.us90DayCents) + " for the same " + cost.units + " units, so about " + match.money(product.us90DayCents - cost.landedCents) + " less.");
      details.push(escapeHtml(result.local.message));
      details.push(escapeHtml(product.brand + " · " + product.manufacturer + " · " + product.ingredient + " " + product.salt + ", " +
        match.formatStrength(product.strength) + " " + product.form + ", " + product.release));
      details.push(escapeHtml("Pack of " + product.packCount + " at " + match.money(product.packPriceCents) + " · " + cost.packs + " packs for 90 days · shipping " + match.money(cost.shippingCents)));
      if (result.note) details.push(escapeHtml(result.note));
    } else if (result.kind === "reject" || result.kind === "sample_reject") {
      sample = result.kind === "sample_reject";
      box.classList.add("reject");
      title.textContent = "✗ Not a match";
      lines.push(result.kind === "reject" ? result.message : result.local.message);
      lines.push("No price is shown." + (sample && result.local.product ? " The closest sample listing is " + result.local.product.brand + "." : ""));
      if (result.note) details.push(escapeHtml(result.note));
    } else if (result.kind === "blocked") {
      box.classList.add("blocked");
      title.textContent = "Not available here";
      lines.push(result.local.message);
    } else if (result.kind === "invalid") {
      box.classList.add("unknown");
      title.textContent = "Need more detail";
      lines.push(result.local.message);
    } else {
      box.classList.add("unknown");
      title.textContent = "Not in the sample table";
      lines.push(result.local ? result.local.message : "No result.");
      if (result.note) lines.push(result.note);
    }

    head.appendChild(title);
    if (sample) head.appendChild(el("span", "badge sample", "Sample data"));
    box.appendChild(head);
    lines.forEach(function (line) { box.appendChild(el("p", "", line)); });
    var rx = rxnormText(result.identity);
    if (rx) details.unshift(escapeHtml(rx));
    if (details.length) {
      var more = el("details");
      more.appendChild(el("summary", "", "Details"));
      details.forEach(function (html) {
        var p = el("p");
        p.innerHTML = html;
        more.appendChild(p);
      });
      box.appendChild(more);
    }
    box.appendChild(el("p", "warn", "Not medical advice. Confirm with a pharmacist before switching." + (sample ? " Sample prices are illustrations, not live listings." : "")));
    return box;
  }

  function runSearch() {
    session.mode = "searching";
    var request = chat.searchInput(session.draft);
    track("clicked_find_equivalent", { drug_name: request.name, strength: request.strength });
    setBusy(true);
    var done = typing("Checking RxNorm and supplier pages…");
    lookup.search(request).then(function (result) {
      done();
      setBusy(false);
      track("showed_result", { status: result.kind, rxcui: result.identity && result.identity.rxcui ? result.identity.rxcui : "" });
      session.history.push({ role: "assistant", content: "Search finished for " + medLabel(request) + "." });
      session.lastResult = result;
      card(resultCard(result));
      afterSearch(result);
    });
  }

  function anotherChoice() {
    return { label: "Check another medicine", onClick: function () { me("Check another medicine"); restart(); } };
  }

  function queueChoice() {
    if (!session.queue.length) return null;
    var label = "Next from your prescription: " + medLabel(session.queue[0]);
    return { label: label, onClick: function () { me(label); nextFromQueue(); } };
  }

  function afterSearch(result) {
    session.mode = "after_search";
    var choices = [];
    if (result.kind !== "blocked") {
      choices.push({ label: "Save & set a refill reminder", primary: true, onClick: function () { me("Save & set a refill reminder"); startSave(); } });
    }
    if (queueChoice()) choices.push(queueChoice());
    choices.push(anotherChoice());
    bot("Tap Details on the card for more. What would you like to do next?", choices);
  }

  function restart() {
    session = freshSession();
    askField("name");
  }

  function nextFromQueue() {
    var queue = session.queue.slice(1);
    var next = session.queue[0];
    var fileName = session.fileName;
    session = freshSession();
    session.draft = next;
    session.queue = queue;
    session.fileName = fileName;
    continueIntake("");
  }

  // ---------- saving a medicine and its refill ----------

  function supplyChoices() {
    return [refill.DEFAULT_SUPPLY_DAYS, 30, 90].map(function (days) {
      var label = days + " days" + (days === refill.DEFAULT_SUPPLY_DAYS ? " (default)" : "");
      return { label: label, primary: days === refill.DEFAULT_SUPPLY_DAYS, onClick: function () { me(label); setSupply(days); } };
    });
  }

  function startSave() {
    session.save = { supplyDays: session.draft.supplyDays || null, leadDays: refill.DEFAULT_LEAD_DAYS, sellerId: "" };
    if (session.save.supplyDays) askSeller();
    else askSupply();
  }

  function askSupply() {
    session.mode = "save_supply";
    session.asked = "supplyDays";
    bot(chat.QUESTIONS.supplyDays + " If you're not sure, use the default of " + refill.DEFAULT_SUPPLY_DAYS + " days.", supplyChoices());
  }

  function setSupply(days) {
    session.save.supplyDays = days;
    askSeller();
  }

  // The sellers the live search found and match.js verified, cheapest first.
  function liveSellers() {
    var result = session.lastResult;
    if (!result || result.kind !== "suppliers") return [];
    return result.filtered.suppliers.slice().sort(function (a, b) { return a.cost.landed - b.cost.landed; }).map(function (row) {
      var name = row.supplier || "Supplier";
      // A live seller with the same name as a seller in the ranking keeps that seller's record.
      var known = sellers.list().filter(function (seller) { return seller.name.toLowerCase() === name.toLowerCase(); })[0];
      return {
        id: known ? known.id : "live-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name: name,
        pageUrl: row.pageUrl,
        label: name + " · " + formatAmount(row.cost.landed, row.currency) + " for 90 days"
      };
    });
  }

  function askSeller() {
    session.mode = "save_seller";
    var live = liveSellers();
    if (live.length) {
      bot("Which seller should this order go to? These are the listings the search found and verified, cheapest first.", live.map(function (seller) {
        return { label: seller.label, onClick: function () { me(seller.label); setSeller(seller.id, seller.name, seller.pageUrl); } };
      }));
      return;
    }
    var top = rankedSellers().slice(0, 3);
    var choices = [{ label: "Let the ranking pick", primary: true, onClick: function () { me("Let the ranking pick"); setSeller(""); } }];
    top.forEach(function (seller) {
      var label = seller.name + " · " + seller.ratingAverage.toFixed(1) + "★";
      choices.push({ label: label, onClick: function () { me(label); setSeller(seller.id); } });
    });
    bot("Which seller should this order go to? This result came from the sample catalog, so these are the demo sellers, ranked by smoothed ratings and fulfillment.", choices);
  }

  function setSeller(id, name, pageUrl) {
    session.save.sellerId = id;
    session.save.sellerName = name || (id ? sellerName(id) : "");
    session.save.sellerUrl = pageUrl || "";
    showSaveSummary();
  }

  function sellerName(id) {
    var found = rankedSellers().filter(function (seller) { return seller.id === id; })[0];
    return found ? found.name : id;
  }

  function showSaveSummary() {
    var plan = refill.schedule(today, session.save.supplyDays, session.save.leadDays);
    if (!plan.ok) {
      bot(plan.message);
      session.save.leadDays = refill.DEFAULT_LEAD_DAYS;
      return askSupply();
    }
    session.mode = "confirm_save";
    var box = el("div", "summary");
    box.appendChild(el("p", "card-title", "Save this medicine and refill plan?"));
    box.appendChild(summaryList([
      { label: "Medicine", value: medLabel(session.draft) + (session.draft.release ? ", " + session.draft.release : "") },
      { label: "Supply", value: plan.supplyDays + " days from today" },
      { label: "Next refill", value: niceDate(plan.refillDueOn) },
      { label: "Reminder", value: niceDate(plan.reminderOn) + " (" + plan.leadDays + " days before)" },
      { label: "Seller", value: session.save.sellerName || "Chosen by the ranking when you save" }
    ]));
    if (session.save.sellerUrl) {
      var link = el("a", "", "Open " + session.save.sellerName + "'s page");
      link.href = session.save.sellerUrl;
      link.target = "_blank";
      link.rel = "noopener";
      var linkRow = el("p");
      linkRow.appendChild(link);
      box.appendChild(linkRow);
    }
    box.appendChild(el("p", "hint", "Saved in this browser only. MedFinder doesn't take payment or ship medicine" +
      (session.save.sellerUrl ? ", so you order on the seller's page" : "") + ". To change the reminder, say something like \"remind me 10 days before\"."));
    card(box, [
      { label: "Save", primary: true, onClick: function () { me("Save"); saveNow(); } },
      { label: "Cancel", onClick: function () { me("Cancel"); cancelSave(); } }
    ]);
  }

  function cancelSave() {
    session.mode = "after_search";
    session.save = null;
    var choices = [];
    if (queueChoice()) choices.push(queueChoice());
    choices.push(anotherChoice());
    bot("OK, nothing was saved.", choices);
  }

  function saveNow() {
    var draft = session.draft;
    var med = {
      name: draft.name,
      strength: draft.strength,
      form: draft.form,
      release: draft.release,
      frequency: draft.frequency,
      quantity: draft.quantity,
      supplyDays: session.save.supplyDays
    };
    var saved = clinic.confirmPrescription(state, { sourceFileName: session.fileName, savedAt: today, medications: [med] });
    if (!saved.ok) {
      bot(saved.message);
      return;
    }
    var order = clinic.placeOrder(saved.state, Object.assign({}, med, {
      leadDays: session.save.leadDays,
      orderedAt: today,
      prescriptionId: saved.prescription.id,
      sellerId: session.save.sellerId || "",
      sellerName: session.save.sellerName || ""
    }), {
      sellers: clinic.projectSellers(sellers.list(), state.orders),
      random: Math.random,
      matchDrug: match.matchDrug
    });
    if (!order.ok) {
      bot(order.message);
      return;
    }
    state = order.state;
    persist();
    mirror("prescription", saved.prescription);
    mirror("order", order.order);
    track("saved_prescription", { count: 1 });
    track("placed_order", { seller_id: order.order.sellerId, assigned: !session.save.sellerId });
    renderPanel();
    session.mode = "done";
    var choices = [];
    if (queueChoice()) choices.push(queueChoice());
    choices.push({ label: "Open My meds", keep: true, onClick: openPanel });
    choices.push(anotherChoice());
    bot("Saved with " + order.order.sellerName + ". Next refill " + niceDate(order.order.refillDueOn) + ". A reminder will show here from " +
      niceDate(order.order.reminderOn) + ". You'll find it under My meds.", choices);
  }

  // ---------- typed messages ----------

  function onText(text) {
    me(text);
    var mode = session.mode;
    if (mode === "searching") return;
    if (mode === "confirm_search") {
      if (chat.isYes(text)) return runSearch();
      session.asked = "";
      return sendTurn(text);
    }
    if (mode === "save_supply") {
      var supply = chat.interpretShortAnswer("supplyDays", text) || (/default|not sure|don'?t know/i.test(text) ? { supplyDays: refill.DEFAULT_SUPPLY_DAYS } : null);
      if (supply) return setSupply(supply.supplyDays);
      return askSupply();
    }
    if (mode === "save_seller") {
      var lower = text.toLowerCase();
      var live = liveSellers();
      if (live.length) {
        var pick = live.filter(function (seller) { return lower.indexOf(seller.name.toLowerCase()) !== -1; })[0];
        if (!pick && /cheap|lowest|first|any|you choose|don'?t care|whatever/i.test(text)) pick = live[0];
        if (pick) return setSeller(pick.id, pick.name, pick.pageUrl);
        return askSeller();
      }
      var found = rankedSellers().filter(function (seller) { return lower.indexOf(seller.name.toLowerCase()) !== -1; })[0];
      if (found) return setSeller(found.id);
      if (/rank|pick|any|you choose|don'?t care|whatever|default/i.test(text)) return setSeller("");
      return askSeller();
    }
    if (mode === "confirm_save") {
      var lead = text.match(/(\d{1,3})\s*days?\s*(before|ahead|early|earlier|prior)/i);
      if (lead) {
        session.save.leadDays = Number(lead[1]);
        return showSaveSummary();
      }
      if (chat.isYes(text) || /^save\b/i.test(text)) return saveNow();
      if (/^(no|cancel|stop|don'?t)\b/i.test(text)) return cancelSave();
      bot("Tap Save to keep it, or Cancel. You can also say \"remind me 10 days before\".");
      return;
    }
    sendTurn(text);
  }

  composer.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text || session.busy) return;
    input.value = "";
    onText(text.slice(0, 600));
  });

  document.getElementById("attach").addEventListener("click", function () {
    if (session.busy) return;
    fileInput.click();
  });

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (file && !session.busy) readFile(file);
  });

  // ---------- My meds panel ----------

  function openReminders() {
    return clinic.reminders(state, today).filter(function (note) { return !note.read; });
  }

  function renderPanel() {
    var open = openReminders();
    var count = document.getElementById("reminder-count");
    count.textContent = open.length ? String(open.length) : "";
    count.hidden = !open.length;

    var body = document.getElementById("panel-body");
    body.innerHTML = "";

    var reminders = el("section");
    reminders.appendChild(el("h3", "", "Reminders"));
    if (!open.length) reminders.appendChild(el("p", "hint", "No reminder is due. One appears here " + refill.DEFAULT_LEAD_DAYS + " days before a refill, unless you chose a different lead."));
    open.forEach(function (note) {
      var row = el("div", "notice");
      row.appendChild(el("p", "", note.message));
      var dismiss = el("button", "small", "Dismiss");
      dismiss.type = "button";
      dismiss.addEventListener("click", function () {
        state = clinic.markNotificationRead(state, note.id);
        persist();
        renderPanel();
      });
      row.appendChild(dismiss);
      reminders.appendChild(row);
    });
    body.appendChild(reminders);

    var meds = el("section");
    meds.appendChild(el("h3", "", "My medicines"));
    if (!state.orders.length) meds.appendChild(el("p", "hint", "Nothing saved yet. After a search, choose \"Save & set a refill reminder\"."));
    state.orders.slice().reverse().forEach(function (order) {
      var item = el("div", "med-card");
      item.appendChild(el("p", "med-title", [order.name, order.strength, order.form].filter(Boolean).join(" ") + (order.release ? ", " + order.release : "")));
      item.appendChild(el("p", "hint", order.sellerName + " · ordered " + niceDate(order.orderedAt) + " · " + order.supplyDays + "-day supply"));
      item.appendChild(el("p", "", "Next refill " + niceDate(order.refillDueOn) + " · reminder " + niceDate(order.reminderOn)));
      var actions = el("div", "row-actions");
      if (order.status !== "fulfilled") {
        var fulfil = el("button", "small", "Mark fulfilled");
        fulfil.type = "button";
        fulfil.addEventListener("click", function () {
          var result = clinic.fulfillOrder(state, order.id, today);
          if (!result.ok) return;
          state = result.state;
          persist();
          mirror("order", result.order);
          renderPanel();
        });
        actions.appendChild(fulfil);
      } else if (!order.rating) {
        actions.appendChild(el("span", "hint", "Rate " + order.sellerName + ":"));
        [1, 2, 3, 4, 5].forEach(function (stars) {
          var star = el("button", "small star", stars + "★");
          star.type = "button";
          star.setAttribute("aria-label", stars + " star" + (stars === 1 ? "" : "s"));
          star.addEventListener("click", function () {
            var rated = clinic.rateOrder(state, order.id, { stars: stars, comment: "", ratedAt: today });
            if (!rated.ok) return;
            state = rated.state;
            persist();
            mirror("rating", rated.order);
            track("rated_seller", { stars: stars });
            renderPanel();
          });
          actions.appendChild(star);
        });
      } else {
        actions.appendChild(el("span", "hint", "Fulfilled · your rating " + order.rating.stars + "★"));
      }
      item.appendChild(actions);
      meds.appendChild(item);
    });
    body.appendChild(meds);

    var board = el("details", "board");
    board.appendChild(el("summary", "", "Seller ranking (demo data)"));
    var list = el("ol");
    rankedSellers().forEach(function (seller) {
      var li = el("li");
      li.appendChild(el("strong", "", seller.name));
      li.appendChild(el("span", "hint", " · " + seller.ratingAverage.toFixed(2) + "★ smoothed from " + seller.ratingCount + " rating" + (seller.ratingCount === 1 ? "" : "s") +
        " · " + Math.round(seller.reliability * 100) + "% fulfilled · gets about " + (seller.share * 100).toFixed(0) + "% of assigned orders"));
      list.appendChild(li);
    });
    board.appendChild(list);
    board.appendChild(el("p", "hint", "One new 5-star rating does not jump a seller ahead of a longer record."));
    body.appendChild(board);

    var demo = el("div", "row-actions");
    var sample = el("button", "small", "Load sample orders");
    sample.type = "button";
    sample.addEventListener("click", function () {
      state = clinic.sampleState(today, sellers.list());
      persist();
      renderPanel();
    });
    var clear = el("button", "small", "Clear this browser's saved data");
    clear.type = "button";
    clear.addEventListener("click", function () {
      state = clinic.emptyState();
      try { localStorage.removeItem(STORAGE_KEY); } catch (error) {}
      renderPanel();
    });
    demo.appendChild(sample);
    demo.appendChild(clear);
    body.appendChild(demo);
    body.appendChild(el("p", "hint", "Sample orders replace what this browser has saved."));
  }

  function openPanel() {
    renderPanel();
    if (typeof panel.showModal === "function") panel.showModal();
    else panel.setAttribute("open", "");
  }

  document.getElementById("open-panel").addEventListener("click", openPanel);
  document.getElementById("open-about").addEventListener("click", function () {
    if (typeof about.showModal === "function") about.showModal();
    else about.setAttribute("open", "");
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (button) {
    button.addEventListener("click", function () {
      var dialog = button.closest("dialog");
      if (dialog.close) dialog.close();
      else dialog.removeAttribute("open");
    });
  });
  [panel, about].forEach(function (dialog) {
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog && dialog.close) dialog.close();
    });
  });

  document.getElementById("run-checks").addEventListener("click", function () {
    var list = document.getElementById("checks");
    var results = match.runChecks();
    var passed = results.filter(function (item) { return item.passed; }).length;
    list.innerHTML = "<li><strong>" + passed + " of " + results.length + " passed</strong></li>" + results.map(function (item) {
      return "<li>" + (item.passed ? "<span class='pass'>Pass</span>" : "<span class='fail'>Fail</span>") + " · " + escapeHtml(item.name) + "</li>";
    }).join("");
  });

  // ---------- start ----------

  // Asks the server whether it is up and has its OpenRouter key. Render's free plan puts an idle
  // server to sleep, and the first request wakes it, which can take about a minute.
  var keyMissing = false;
  function probeServer() {
    if (location.protocol === "file:") return Promise.resolve(false);
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 90000);
    var waking = null;
    var wakeTimer = setTimeout(function () {
      waking = typing("Waking up the MedFinder server… On the free plan this can take up to a minute.");
    }, 2500);
    return fetch(api("/health"), { signal: controller ? controller.signal : undefined }).then(function (response) {
      return response.json();
    }).then(function (body) {
      keyMissing = !!body && body.ok === true && body.ready === false;
      return !!body && body.ok === true && body.ready === true;
    }).catch(function () {
      return false;
    }).then(function (up) {
      clearTimeout(timer);
      clearTimeout(wakeTimer);
      if (waking) waking();
      return up;
    });
  }

  var probing = null;
  function ensureServer() {
    if (online === true) return Promise.resolve(true);
    if (!probing) {
      setBusy(true);
      probing = probeServer().then(function (up) {
        online = up;
        probing = null;
        setBusy(false);
        return up;
      });
    }
    return probing;
  }

  function greet() {
    bot("Hi! I'll help you check whether your long-term medicine has an exact equivalent sold in India, and what a 90-day supply would cost.");
    askField("name");
  }

  function reconnect() {
    ensureServer().then(function (up) {
      if (up) return askField("name");
      bot(keyMissing ? keyMissingText() : offlineText(), offlineChoices());
    });
  }

  function keyMissingText() {
    return "The MedFinder server is running, but its OpenRouter key isn't set, so the chat and prescription reading are off. You can still try a sample medicine below.";
  }

  function start() {
    renderPanel();
    var due = openReminders();
    if (due.length) {
      bot(due[0].message + (due.length > 1 ? " (" + (due.length - 1) + " more in My meds.)" : ""), [
        { label: "Open My meds", keep: true, onClick: openPanel }
      ]);
    }
    ensureServer().then(function (up) {
      var params = new URLSearchParams(location.search);
      if (params.get("checks") === "1") {
        document.getElementById("open-about").click();
        document.getElementById("run-checks").click();
      }
      if (params.get("demo") === "lipitor") {
        session.draft = chat.normalizeDraft(SAMPLES[0]);
        bot("Here's the Lipitor 20 mg sample.");
        showSummary();
        return;
      }
      if (!up) {
        bot(keyMissing ? keyMissingText() : offlineText(), offlineChoices());
        return;
      }
      greet();
    });
  }

  start();
})();
