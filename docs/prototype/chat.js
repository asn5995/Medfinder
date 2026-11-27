// Chat intake decisions. The model is not called from this file.
// It holds the details the app needs, accepts a detail only when it appears in the
// patient's own words, and picks the next question. match.js still decides every match.

(function (root, factory) {
  var extract = null;
  if (typeof require === "function") extract = require("./extract.js");
  else if (root) extract = root.MedFinderExtract;
  var api = factory(extract);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MedFinderChat = api;
})(typeof window !== "undefined" ? window : null, function (extract) {
  // Search needs these four, in this order. Nothing else is asked before a search.
  var SEARCH_FIELDS = ["name", "strength", "form", "release"];
  // Kept when the patient mentions them. Never asked for, because no decision uses them.
  var OPTIONAL_FIELDS = ["frequency", "quantity", "supplyDays"];
  var FIELDS = SEARCH_FIELDS.concat(OPTIONAL_FIELDS);

  var LABELS = {
    name: "medicine name",
    strength: "strength",
    form: "form",
    release: "release type",
    frequency: "frequency",
    quantity: "quantity",
    supplyDays: "supply length"
  };

  var QUESTIONS = {
    name: "What is the name of the medicine? Type the brand or generic name as it's printed, or attach a photo or PDF of the prescription.",
    strength: "What strength is it? It's printed next to the name, for example 20 mg or 50 mcg.",
    form: "Is it a tablet, a capsule, or an injection?",
    release: "Does the name or label include ER, XL, XR, SR, or \"extended-release\"?",
    supplyDays: "How many days does one fill last?"
  };

  var CHOICES = {
    form: [
      { label: "Tablet", value: "tablet" },
      { label: "Capsule", value: "capsule" },
      { label: "Injection", value: "injection" }
    ],
    release: [
      { label: "No, regular", value: "IR" },
      { label: "Yes, extended-release", value: "ER" }
    ]
  };

  var MEDICAL_REFUSAL = "I can't give medical advice, including about doses, side effects, interactions, or switching or stopping a medicine. Please ask your doctor or pharmacist. I can keep helping you check for an equivalent.";

  // Asked before any model call. A match here never reaches the model.
  var ADVICE_PATTERN = new RegExp([
    "\\b(should|can|could|may|must) i (take|stop|start|switch|skip|double|halve|split|crush|increase|decrease|lower|raise|change|mix|drink|combine|use)\\b",
    "\\bis it (safe|ok|okay|dangerous|bad|fine) (to|if)\\b",
    "\\bside effects?\\b",
    "\\binteract(s|ion|ions)?\\b",
    "\\boverdose\\b",
    "\\bhow (much|many|often) should i\\b",
    "\\bwhat dose should\\b",
    "\\b(pregnant|breastfeeding)\\b",
    "\\binstead of my\\b"
  ].join("|"), "i");

  function clean(value, limit) {
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, limit);
  }

  function plain(value) {
    return " " + String(value == null ? "" : value).toLowerCase()
      .replace(/milligrams?/g, "mg")
      .replace(/micrograms?|mcgs?\b|µg/g, "mcg")
      .replace(/[^a-z0-9./]+/g, " ")
      .replace(/\.(?!\d)/g, " ")
      .replace(/\s+/g, " ")
      .trim() + " ";
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function wholeDays(value) {
    var number = Number(value);
    if (value === "" || value == null || !isFinite(number) || Math.floor(number) !== number || number <= 0 || number > 365) return null;
    return number;
  }

  // Same units as match.js parseStrength: mg, mcg, g, units/ml.
  function normalizeStrength(value) {
    var text = plain(value).replace(/\s+/g, " ");
    var match = text.match(/(\d+(?:\.\d+)?)\s?(mg|mcg|g|units\/ml)(?![a-z])/);
    if (!match) return "";
    return Number(match[1]) + " " + match[2];
  }

  function normalizeReleaseValue(value) {
    var text = String(value == null ? "" : value).trim().toUpperCase();
    if (text === "IR" || text === "ER") return text;
    return extract.normalizeRelease(value);
  }

  function normalizeField(field, value) {
    if (field === "name") return clean(value, 120);
    if (field === "strength") return normalizeStrength(value);
    if (field === "form") return extract.normalizeForm(value);
    if (field === "release") return normalizeReleaseValue(value);
    if (field === "supplyDays") return wholeDays(value);
    return clean(value, 80);
  }

  function emptyDraft() {
    return {
      name: "",
      strength: "",
      form: "",
      release: "",
      frequency: "",
      quantity: "",
      supplyDays: null,
      suggested: {}
    };
  }

  // Keeps only known fields in the app's own format. Anything else is dropped.
  function normalizeDraft(input) {
    var source = input && typeof input === "object" ? input : {};
    var draft = emptyDraft();
    FIELDS.forEach(function (field) {
      var value = normalizeField(field, source[field]);
      if (value) draft[field] = value;
    });
    if (source.suggested && source.suggested.release === true && draft.release) draft.suggested.release = true;
    return draft;
  }

  function hasNumber(text, number) {
    return new RegExp("(^|[^\\d.])" + escapeRegExp(number) + "(?![\\d.])").test(text);
  }

  // A detail counts only when the patient's own words contain it.
  function grounded(field, value, sourceText, draft) {
    var source = plain(sourceText);
    if (field === "name") {
      var name = plain(value).trim();
      return !!name && source.indexOf(" " + name + " ") !== -1;
    }
    if (field === "strength") {
      var parts = value.split(" ");
      if (!hasNumber(source, parts[0])) return false;
      var unit = escapeRegExp(parts[1]);
      if (new RegExp("(^|[^\\d.])" + escapeRegExp(parts[0]) + "\\s?" + unit + "(?![a-z])").test(source)) return true;
      return new RegExp(" " + unit + " ").test(source) || (!!draft.strength && draft.strength.split(" ")[1] === parts[1]);
    }
    if (field === "form") return extract.formsIn(source).indexOf(value) !== -1;
    if (field === "release") {
      var words = source.replace(/-/g, " ");
      if (value === "ER") return extract.EXTENDED_WORDS.test(words);
      return extract.IMMEDIATE_WORDS.test(words) || /\b(normal|standard|not extended|no er|no xl)\b/.test(words);
    }
    // "30 a month" is a quantity, not a supply length. Only "30 days" or "30-day" counts.
    if (field === "supplyDays") return new RegExp("(^|[^\\d.])" + value + " ?days?\\b").test(source);
    if (field === "quantity") {
      var digits = String(value).match(/\d+/g) || [];
      return digits.length > 0 && digits.every(function (digit) { return hasNumber(source, digit); });
    }
    if (field === "frequency") {
      var wordsInValue = plain(value).trim().split(" ").filter(function (word) { return word.length >= 3; });
      if (!wordsInValue.length) return false;
      var hits = wordsInValue.filter(function (word) { return source.indexOf(" " + word + " ") !== -1; });
      return hits.length / wordsInValue.length >= 0.6;
    }
    return false;
  }

  function copyDraft(draft) {
    var next = normalizeDraft(draft);
    return next;
  }

  // Applies proposed updates. Each one must be in the app's format and in the patient's words.
  // A later value replaces an earlier one, which is how corrections work.
  function applyUpdates(draft, updates, sourceText, options) {
    var trusted = options && options.trusted;
    var next = copyDraft(draft);
    var accepted = {};
    var rejected = [];
    var proposed = updates && typeof updates === "object" && !Array.isArray(updates) ? updates : {};
    FIELDS.forEach(function (field) {
      if (!Object.prototype.hasOwnProperty.call(proposed, field)) return;
      var raw = proposed[field];
      if (raw == null || raw === "") return;
      var value = normalizeField(field, raw);
      if (!value) {
        rejected.push({ field: field, reason: "format" });
        return;
      }
      if (value === next[field]) return;
      if (!trusted && !grounded(field, value, sourceText, next)) {
        rejected.push({ field: field, reason: "not_in_message" });
        return;
      }
      next[field] = value;
      accepted[field] = value;
      if (field === "release") delete next.suggested.release;
    });
    // A name such as "Toprol XL" already says extended-release, the same rule the file reader uses.
    if (!next.release && next.name && extract.normalizeRelease(next.name) === "ER") {
      next.release = "ER";
      accepted.release = "ER";
    }
    return { draft: next, accepted: accepted, rejected: rejected };
  }

  function nextMissing(draft) {
    for (var i = 0; i < SEARCH_FIELDS.length; i += 1) {
      if (!draft[SEARCH_FIELDS[i]]) return SEARCH_FIELDS[i];
    }
    return "";
  }

  function askFor(field) {
    return {
      field: field,
      text: QUESTIONS[field] || "",
      choices: (CHOICES[field] || []).slice()
    };
  }

  function shortMessage(text) {
    return clean(text, 200).split(" ").filter(Boolean).length <= 4;
  }

  // Short replies to the question just asked are read by code, with no model call.
  function interpretShortAnswer(asked, text) {
    var value = clean(text, 200).toLowerCase().replace(/[.!]+$/, "");
    if (!value || !shortMessage(value)) return null;
    if (asked === "release") {
      if (/^(no|nope|nah|not|regular|normal|standard|plain|ir|immediate)\b/.test(value)) return { release: "IR" };
      if (/^(yes|yep|yeah|it does|er|xl|xr|sr|cr|extended)\b/.test(value)) return { release: "ER" };
    }
    if (asked === "form") {
      var form = extract.normalizeForm(value);
      if (form) return { form: form };
    }
    if (asked === "strength") {
      var strength = normalizeStrength(value);
      if (strength) return { strength: strength };
    }
    if (asked === "supplyDays") {
      var days = value.match(/^(\d{1,3})\s*(days?)?$/);
      if (days && wholeDays(days[1])) return { supplyDays: Number(days[1]) };
    }
    return null;
  }

  function isYes(text) {
    return /^(yes|yep|yeah|y|ok|okay|correct|right|looks (good|right)|that'?s (right|correct)|confirm|go( ahead)?|search|sure)\b[\s.!]*$/i.test(clean(text, 60));
  }

  function asksForMedicalAdvice(text) {
    return ADVICE_PATTERN.test(String(text || ""));
  }

  // RxNorm lists the versions that exist. If every listed version at this strength and form is
  // regular (or every one is extended-release), the app suggests it and the patient confirms.
  function suggestRelease(conceptNames, strength, form) {
    var parsed = normalizeStrength(strength);
    if (!parsed) return "";
    // RxNorm writes 50 mcg as "0.05 MG", so both spellings are looked for.
    var parts = parsed.split(" ");
    var needles = [parts[0] + " " + parts[1].toUpperCase()];
    if (parts[1] === "mcg") needles.push(String(Number(parts[0]) / 1000) + " MG");
    if (parts[1] === "g") needles.push(String(Number(parts[0]) * 1000) + " MG");
    var formWord = form === "injection" ? "inject" : form;
    var pool = (conceptNames || []).map(function (name) { return String(name || ""); }).filter(function (name) {
      var upper = " " + name.toUpperCase().replace(/\s+/g, " ");
      var hasStrength = needles.some(function (needle) {
        return new RegExp("[^\\d.]" + escapeRegExp(needle) + "(?![A-Z/])").test(upper);
      });
      if (!hasStrength) return false;
      return !formWord || upper.toLowerCase().indexOf(formWord) !== -1;
    });
    if (!pool.length) return "";
    var kinds = {};
    pool.forEach(function (name) {
      var lower = name.toLowerCase();
      if (/delayed release|\bdr\b|enteric/.test(lower)) kinds.DR = true;
      else if (/extended release|\b(12|24) hr\b|\ber\b|\bxr\b|\bxl\b|\bsr\b|sustained/.test(lower)) kinds.ER = true;
      else kinds.IR = true;
    });
    var found = Object.keys(kinds);
    if (found.length !== 1 || found[0] === "DR") return "";
    return found[0];
  }

  function withSuggestedRelease(draft, release) {
    var next = copyDraft(draft);
    if (next.release || (release !== "IR" && release !== "ER")) return next;
    next.release = release;
    next.suggested.release = true;
    return next;
  }

  function releaseText(draft) {
    if (!draft.release) return "";
    var text = draft.release === "ER" ? "Extended-release (ER)" : "Regular (IR)";
    if (draft.suggested && draft.suggested.release) text += ", the only version RxNorm lists at this strength";
    return text;
  }

  function summary(draft) {
    var rows = [
      { label: "Medicine", value: draft.name },
      { label: "Strength", value: draft.strength },
      { label: "Form", value: draft.form },
      { label: "Release", value: releaseText(draft) }
    ];
    if (draft.frequency) rows.push({ label: "Frequency", value: draft.frequency });
    if (draft.quantity) rows.push({ label: "Quantity", value: draft.quantity });
    if (draft.supplyDays) rows.push({ label: "Supply", value: draft.supplyDays + " days" });
    return rows;
  }

  function searchInput(draft) {
    return { name: draft.name, strength: draft.strength, form: draft.form, release: draft.release };
  }

  // Fields read from an uploaded file come from the reader, not from chat text.
  function fromExtraction(med) {
    return normalizeDraft(med || {});
  }

  function fallbackReply(next, rejected, intent) {
    var question = next ? QUESTIONS[next] : "Here's a summary. Check it before I search.";
    var missedSearchField = (rejected || []).filter(function (item) {
      return SEARCH_FIELDS.indexOf(item.field) !== -1;
    })[0];
    if (missedSearchField) {
      return "I couldn't find the " + LABELS[missedSearchField.field] + " written in your message, so I left it blank. " + question;
    }
    if (intent === "off_topic") return "I can only help you enter a medicine to check. " + question;
    if (intent === "unclear") return "Sorry, I didn't follow that. " + question;
    return question;
  }

  return {
    SEARCH_FIELDS: SEARCH_FIELDS,
    OPTIONAL_FIELDS: OPTIONAL_FIELDS,
    FIELDS: FIELDS,
    LABELS: LABELS,
    QUESTIONS: QUESTIONS,
    MEDICAL_REFUSAL: MEDICAL_REFUSAL,
    emptyDraft: emptyDraft,
    normalizeDraft: normalizeDraft,
    normalizeStrength: normalizeStrength,
    grounded: grounded,
    applyUpdates: applyUpdates,
    nextMissing: nextMissing,
    askFor: askFor,
    interpretShortAnswer: interpretShortAnswer,
    isYes: isYes,
    asksForMedicalAdvice: asksForMedicalAdvice,
    suggestRelease: suggestRelease,
    withSuggestedRelease: withSuggestedRelease,
    summary: summary,
    searchInput: searchInput,
    fromExtraction: fromExtraction,
    fallbackReply: fallbackReply
  };
});
