// Turns a model response into medication fields the patient can confirm.
// The model is not called from this file.

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MedFinderExtract = api;
})(typeof window !== "undefined" ? window : null, function () {
  var FIELD_LIMIT = 80;
  var NAME_LIMIT = 120;
  var MEDICATION_LIMIT = 12;

  function cleanText(value, limit) {
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, limit);
  }

  function strengthText(value) {
    if (value && typeof value === "object" && value.value != null) {
      return cleanText(String(value.value) + (value.unit ? " " + value.unit : ""), FIELD_LIMIT);
    }
    return cleanText(value, FIELD_LIMIT);
  }

  function supplyDays(value) {
    if (value == null || value === "") return null;
    var number = Number(value);
    if (!isFinite(number) || Math.floor(number) !== number || number <= 0 || number > 365) return null;
    return number;
  }

  // Form and release are kept only when the words are printed. A blank means "ask the patient".
  var FORM_WORDS = {
    tablet: /\b(tab|tabs|tablet|tablets)\b/,
    capsule: /\b(cap|caps|capsule|capsules)\b/,
    injection: /\b(inj|injection|injections|injectable|pen|vial|syringe)\b/
  };
  var DELAYED_WORDS = /\b(dr|ec|delayed|enteric)\b/;
  var EXTENDED_WORDS = /\b(er|xl|xr|sr|cr|extended|sustained|controlled|24 ?hr|12 ?hr)\b/;
  var IMMEDIATE_WORDS = /\b(ir|immediate|regular)\b/;

  function wordText(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/-/g, " ");
  }

  function formsIn(value) {
    var text = wordText(value);
    return Object.keys(FORM_WORDS).filter(function (form) { return FORM_WORDS[form].test(text); });
  }

  function normalizeForm(value) {
    var found = formsIn(value);
    return found.length === 1 ? found[0] : "";
  }

  function normalizeRelease(value) {
    var text = wordText(value);
    if (DELAYED_WORDS.test(text)) return "";
    if (EXTENDED_WORDS.test(text)) return "ER";
    if (IMMEDIATE_WORDS.test(text)) return "IR";
    return "";
  }

  function normalizeMedication(row) {
    if (!row || typeof row !== "object") return null;
    var name = cleanText(row.name || row.medication || row.drug, NAME_LIMIT);
    if (!name) return null;
    return {
      name: name,
      strength: strengthText(row.strength || row.dosage || row.dose),
      form: normalizeForm(row.form),
      release: normalizeRelease(row.release) || normalizeRelease(name),
      frequency: cleanText(row.frequency || row.sig || row.directions, FIELD_LIMIT),
      quantity: cleanText(row.quantity || row.qty || row.dispense, FIELD_LIMIT),
      supplyDays: supplyDays(row.supplyDays)
    };
  }

  function result(status, medications, message) {
    return { status: status, medications: medications || [], message: message };
  }

  function parseExtraction(text) {
    var raw = String(text || "").trim();
    var start = raw.indexOf("{");
    var end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return result(
        "unreadable",
        [],
        "This file could not be read as a prescription. Try a clearer photo or PDF, or enter the medicine by hand."
      );
    }

    var parsed;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch (error) {
      return result(
        "unreadable",
        [],
        "This file could not be read as a prescription. Try a clearer photo or PDF, or enter the medicine by hand."
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return result(
        "unreadable",
        [],
        "This file could not be read as a prescription. Try a clearer photo or PDF, or enter the medicine by hand."
      );
    }

    var note = cleanText(parsed.note, 240);
    if (parsed.readable === false) {
      return result(
        "unreadable",
        [],
        note || "This file could not be read. Try a clearer photo or PDF, or enter the medicine by hand."
      );
    }
    if (parsed.isPrescription === false) {
      return result(
        "not_prescription",
        [],
        note || "This file does not look like a prescription. Upload a prescription photo or PDF, or enter the medicine by hand."
      );
    }

    var list = parsed.medications;
    if (list && !Array.isArray(list) && typeof list === "object") list = [list];
    var medications = (Array.isArray(list) ? list : []).map(normalizeMedication).filter(Boolean).slice(0, MEDICATION_LIMIT);
    if (!medications.length) {
      return result(
        "unreadable",
        [],
        note || "No medication name could be read. Enter the medicine by hand."
      );
    }

    return result("ok", medications, "Check these fields, then save. Nothing is stored until you confirm.");
  }

  return {
    parseExtraction: parseExtraction,
    normalizeForm: normalizeForm,
    normalizeRelease: normalizeRelease,
    formsIn: formsIn,
    EXTENDED_WORDS: EXTENDED_WORDS,
    IMMEDIATE_WORDS: IMMEDIATE_WORDS,
    DELAYED_WORDS: DELAYED_WORDS
  };
});
