// Refill and reminder dates for maintenance medicines.
// A supply is assumed to keep going, so the next refill is supplyDays after the order.

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MedFinderRefill = api;
})(typeof window !== "undefined" ? window : null, function () {
  var DEFAULT_SUPPLY_DAYS = 60;
  var DEFAULT_LEAD_DAYS = 20;
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function parseIsoDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
  }

  function formatIsoDate(date) {
    var month = date.getUTCMonth() + 1;
    var day = date.getUTCDate();
    return date.getUTCFullYear() + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
  }

  function addDays(iso, days) {
    var date = parseIsoDate(iso);
    var count = Number(days);
    if (!date || !isFinite(count) || Math.floor(count) !== count) return null;
    date.setUTCDate(date.getUTCDate() + count);
    return formatIsoDate(date);
  }

  function wholeDays(value) {
    var number = Number(value);
    if (!isFinite(number) || Math.floor(number) !== number || number <= 0) return null;
    return number;
  }

  function schedule(orderedAt, supplyDays, leadDays) {
    if (!parseIsoDate(orderedAt)) {
      return { ok: false, reason: "bad_date", message: "Enter the order date as YYYY-MM-DD." };
    }
    var supply = supplyDays == null || supplyDays === "" ? DEFAULT_SUPPLY_DAYS : wholeDays(supplyDays);
    var lead = leadDays == null || leadDays === "" ? DEFAULT_LEAD_DAYS : wholeDays(leadDays);
    if (!supply || supply > 365) {
      return { ok: false, reason: "bad_supply", message: "Supply length must be a whole number of days from 1 to 365." };
    }
    if (!lead || lead > 364) {
      return { ok: false, reason: "bad_lead", message: "Reminder lead time must be a whole number of days." };
    }
    if (lead >= supply) {
      return {
        ok: false,
        reason: "lead_too_long",
        message: "The reminder lead time has to be shorter than the supply length."
      };
    }
    var refillDueOn = addDays(orderedAt, supply);
    return {
      ok: true,
      supplyDays: supply,
      leadDays: lead,
      refillDueOn: refillDueOn,
      reminderOn: addDays(refillDueOn, -lead)
    };
  }

  function monthCells(year, month, marks) {
    var yearNumber = Number(year);
    var monthNumber = Number(month);
    if (!isFinite(yearNumber) || !isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) return [];
    var firstWeekday = new Date(Date.UTC(yearNumber, monthNumber - 1, 1)).getUTCDay();
    var daysInMonth = new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate();
    var total = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    var cursor = new Date(Date.UTC(yearNumber, monthNumber - 1, 1 - firstWeekday));
    var cells = [];
    for (var i = 0; i < total; i++) {
      var iso = formatIsoDate(cursor);
      cells.push({
        date: iso,
        inMonth: cursor.getUTCMonth() === monthNumber - 1,
        refills: (marks && marks[iso]) || []
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return cells;
  }

  return {
    DEFAULT_SUPPLY_DAYS: DEFAULT_SUPPLY_DAYS,
    DEFAULT_LEAD_DAYS: DEFAULT_LEAD_DAYS,
    WEEKDAYS: WEEKDAYS,
    parseIsoDate: parseIsoDate,
    formatIsoDate: formatIsoDate,
    addDays: addDays,
    schedule: schedule,
    monthCells: monthCells
  };
});
