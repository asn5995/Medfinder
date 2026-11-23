// Confirmed prescription and order text. File bytes are refused.
// With no Supabase settings, nothing is written and the browser keeps its own copy.

function clean(value, limit) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, limit);
}

function wholeDays(value) {
  var number = Number(value);
  if (!isFinite(number) || Math.floor(number) !== number || number <= 0 || number > 365) return null;
  return number;
}

function hasFile(record) {
  if (!record || typeof record !== "object") return false;
  return record.dataBase64 != null || record.file != null || record.bytes != null || record.content != null;
}

function normalizeRecord(kind, record) {
  if (hasFile(record)) return { ok: false, reason: "files_not_stored" };
  if (kind === "prescription") return normalizePrescription(record);
  if (kind === "order") return normalizeOrder(record);
  if (kind === "rating") return normalizeRating(record);
  return { ok: false, reason: "bad_record" };
}

function normalizePrescription(record) {
  if (!record || typeof record !== "object") return { ok: false, reason: "bad_record" };
  var medications = (record.medications || []).map(function (row) {
    if (!row || hasFile(row)) return null;
    var name = clean(row.name, 120);
    var days = wholeDays(row.supplyDays);
    if (!name || !days) return null;
    return {
      name: name,
      strength: clean(row.strength, 80),
      frequency: clean(row.frequency, 80),
      quantity: clean(row.quantity, 80),
      supplyDays: days
    };
  }).filter(Boolean).slice(0, 12);
  var id = clean(record.id, 80);
  if (!id || !medications.length) return { ok: false, reason: "bad_record" };
  return {
    ok: true,
    record: {
      id: id,
      patientName: clean(record.patientName || record.patientId, 120) || "Demo patient",
      sourceFileName: clean(record.sourceFileName, 180),
      savedAt: clean(record.savedAt, 40),
      medications: medications
    }
  };
}

function normalizeOrder(record) {
  if (!record || typeof record !== "object") return { ok: false, reason: "bad_record" };
  var id = clean(record.id, 80);
  var name = clean(record.name, 120);
  var supplyDays = wholeDays(record.supplyDays);
  var leadDays = wholeDays(record.leadDays);
  if (!id || !name || !supplyDays || !leadDays) return { ok: false, reason: "bad_record" };
  var status = clean(record.status, 40);
  if (status !== "placed" && status !== "fulfilled") status = "placed";
  return {
    ok: true,
    record: {
      id: id,
      prescriptionId: clean(record.prescriptionId, 80),
      patientName: clean(record.patientName || record.patientId, 120) || "Demo patient",
      sellerId: clean(record.sellerId, 80),
      sellerName: clean(record.sellerName, 120),
      name: name,
      strength: clean(record.strength, 80),
      supplyDays: supplyDays,
      leadDays: leadDays,
      orderedAt: clean(record.orderedAt, 40),
      refillDueOn: clean(record.refillDueOn, 40),
      reminderOn: clean(record.reminderOn, 40),
      status: status,
      fulfilledAt: clean(record.fulfilledAt, 40)
    }
  };
}

function normalizeRating(record) {
  if (!record || typeof record !== "object") return { ok: false, reason: "bad_record" };
  var orderId = clean(record.orderId || record.id, 80);
  var stars = Number(record.stars != null ? record.stars : record.rating && record.rating.stars);
  var comment = clean(record.comment != null ? record.comment : record.rating && record.rating.comment, 500);
  var ratedAt = clean(record.ratedAt != null ? record.ratedAt : record.rating && record.rating.ratedAt, 40);
  if (!orderId || !isFinite(stars) || Math.floor(stars) !== stars || stars < 1 || stars > 5) {
    return { ok: false, reason: "bad_record" };
  }
  return {
    ok: true,
    record: { orderId: orderId, stars: stars, comment: comment, ratedAt: ratedAt }
  };
}

function createMemoryStore() {
  var saved = { prescription: [], order: [], rating: [] };
  return {
    configured: true,
    save: function (kind, record) {
      saved[kind].push(record);
      return Promise.resolve({ ok: true, stored: true });
    },
    saved: saved
  };
}

function createUnsetStore() {
  return {
    configured: false,
    save: function () {
      return Promise.resolve({ ok: false, reason: "database_unset", stored: false });
    }
  };
}

function createSupabaseStore(options) {
  var base = String(options.url || "").replace(/\/$/, "") + "/rest/v1";
  var key = options.serviceRoleKey;
  var fetchImpl = options.fetch;
  function write(table, row) {
    return fetchImpl(base + "/" + table, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(row)
    }).then(function (response) {
      if (response && response.ok) return { ok: true, stored: true };
      return { ok: false, reason: "database_error", stored: false };
    });
  }
  return {
    configured: true,
    save: function (kind, record) {
      if (kind === "prescription") {
        return write("prescriptions", {
          id: record.id,
          patient_name: record.patientName,
          source_file_name: record.sourceFileName,
          saved_at: record.savedAt
        }).then(function (result) {
          if (!result.ok) return result;
          return write("medications", record.medications.map(function (row) {
            return {
              prescription_id: record.id,
              name: row.name,
              strength: row.strength,
              frequency: row.frequency,
              quantity: row.quantity,
              supply_days: row.supplyDays
            };
          }));
        });
      }
      if (kind === "order") {
        return write("orders", {
          id: record.id,
          prescription_id: record.prescriptionId,
          patient_name: record.patientName,
          seller_id: record.sellerId,
          seller_name: record.sellerName,
          name: record.name,
          strength: record.strength,
          supply_days: record.supplyDays,
          lead_days: record.leadDays,
          ordered_at: record.orderedAt,
          refill_due_on: record.refillDueOn,
          reminder_on: record.reminderOn,
          status: record.status,
          fulfilled_at: record.fulfilledAt
        });
      }
      return write("ratings", {
        order_id: record.orderId,
        stars: record.stars,
        comment: record.comment,
        rated_at: record.ratedAt
      });
    }
  };
}

function storeFromEnv(env, fetchImpl) {
  var source = env || {};
  if (source.SUPABASE_URL && source.SUPABASE_SERVICE_ROLE_KEY && fetchImpl) {
    return createSupabaseStore({
      url: source.SUPABASE_URL,
      serviceRoleKey: source.SUPABASE_SERVICE_ROLE_KEY,
      fetch: fetchImpl
    });
  }
  return createUnsetStore();
}

module.exports = {
  normalizeRecord: normalizeRecord,
  createMemoryStore: createMemoryStore,
  createUnsetStore: createUnsetStore,
  createSupabaseStore: createSupabaseStore,
  storeFromEnv: storeFromEnv
};
