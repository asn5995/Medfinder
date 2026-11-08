// The only place a match is decided. Rules, not a model.
// Exact means ingredient, salt, strength, form, and release all agree.

(function () {
  var DAYS = 90;

  function normalizeName(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/\s+/g, " ");
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function nameHits(query, alias) {
    if (!query || !alias) return false;
    if (query === alias) return true;
    return new RegExp("(^| )" + escapeRegExp(alias) + "( |$)").test(query);
  }

  function findIdentity(name) {
    var query = normalizeName(name);
    var best = null;
    window.MEDFINDER_IDENTITIES.forEach(function (identity) {
      identity.names.forEach(function (alias) {
        var normalizedAlias = normalizeName(alias);
        if (!nameHits(query, normalizedAlias)) return;
        if (!best || normalizedAlias.length > best.aliasLength) {
          best = { identity: identity, aliasLength: normalizedAlias.length };
        }
      });
    });
    return best ? best.identity : null;
  }

  function parseStrength(raw) {
    var compact = String(raw || "").toLowerCase().replace(/\s+/g, "");
    var match = compact.match(/^(\d+(?:\.\d+)?)(mg|mcg|g|units\/ml)$/);
    if (!match) return null;
    return { value: Number(match[1]), unit: match[2] };
  }

  function formatStrength(strength) {
    if (!strength) return "";
    return strength.value + " " + strength.unit;
  }

  function normalizeRelease(raw) {
    var key = normalizeName(raw);
    var map = {
      ir: "IR",
      immediate: "IR",
      "immediate release": "IR",
      er: "ER",
      xr: "ER",
      xl: "ER",
      sr: "ER",
      cr: "ER",
      "extended release": "ER"
    };
    return map[key] || "";
  }

  function normalizeForm(raw) {
    var key = normalizeName(raw);
    if (key === "tab" || key === "tabs" || key === "tablets") return "tablet";
    if (key === "caps" || key === "capsule" || key === "capsules") return "capsule";
    if (key === "injection" || key === "injectable") return "injection";
    return key;
  }

  function sameStrength(left, right) {
    return !!left && !!right && left.value === right.value && left.unit === right.unit;
  }

  function money(cents) {
    return "$" + (cents / 100).toFixed(2);
  }

  function landedCost(product) {
    var units = DAYS * product.unitsPerDay;
    var packs = Math.ceil(units / product.packCount);
    var drugCents = packs * product.packPriceCents;
    return {
      days: DAYS,
      unitsPerDay: product.unitsPerDay,
      units: units,
      packs: packs,
      packCount: product.packCount,
      packPriceCents: product.packPriceCents,
      drugCents: drugCents,
      shippingCents: product.shippingCents,
      landedCents: drugCents + product.shippingCents
    };
  }

  function compareProduct(request, product) {
    var failures = [];
    if (request.salt !== product.salt) {
      failures.push({
        rule: "salt",
        detail: "Salt form does not agree: " + (request.salt || "unspecified") + " is not " + product.salt + "."
      });
    }
    if (!sameStrength(request.strength, product.strength)) {
      failures.push({
        rule: "strength",
        detail: "Strength does not agree: " + formatStrength(request.strength) + " is not " + formatStrength(product.strength) + "."
      });
    }
    if (request.form !== product.form) {
      failures.push({
        rule: "form",
        detail: "Dosage form does not agree: " + request.form + " is not " + product.form + "."
      });
    }
    if (request.release !== product.release) {
      failures.push({
        rule: "release",
        detail: "Release type does not agree: " + request.release + " is not " + product.release + "."
      });
    }
    return failures;
  }

  function matchDrug(input) {
    var name = normalizeName(input && input.name);
    if (!name) {
      return { status: "invalid", message: "Enter a drug name.", failures: [], product: null, cost: null };
    }

    var identity = findIdentity(name);
    if (!identity) {
      return {
        status: "unknown",
        message: "That drug is not in the sample table.",
        failures: [],
        product: null,
        cost: null
      };
    }

    if (identity.blocked) {
      return {
        status: "blocked",
        message: identity.blockReason,
        identity: identity,
        failures: [],
        product: null,
        cost: null
      };
    }

    var strength = parseStrength(input.strength);
    var form = normalizeForm(input.form);
    var release = normalizeRelease(input.release);
    if (!strength || !form || !release) {
      return {
        status: "invalid",
        message: "Enter a strength such as 20 mg or 50 mcg, a dosage form, and IR or ER.",
        identity: identity,
        failures: [],
        product: null,
        cost: null
      };
    }

    var request = {
      ingredient: identity.ingredient,
      salt: identity.salt,
      strength: strength,
      form: form,
      release: release
    };

    var sameIngredient = window.MEDFINDER_PRODUCTS.filter(function (product) {
      return product.ingredient === identity.ingredient;
    });

    if (!sameIngredient.length) {
      return {
        status: "unknown",
        message: "That drug is not in the sample table.",
        identity: identity,
        failures: [],
        product: null,
        cost: null
      };
    }

    var ranked = sameIngredient.map(function (product) {
      return { product: product, failures: compareProduct(request, product) };
    }).sort(function (left, right) {
      return left.failures.length - right.failures.length;
    });

    var best = ranked[0];
    if (!best.failures.length) {
      return {
        status: "exact",
        message: "Exact match. Ingredient, salt form, strength, dosage form, and release type agree.",
        identity: identity,
        request: request,
        product: best.product,
        failures: [],
        cost: landedCost(best.product)
      };
    }

    return {
      status: "reject",
      message: "Not a match. " + best.failures.map(function (failure) { return failure.detail; }).join(" "),
      identity: identity,
      request: request,
      product: best.product,
      failures: best.failures,
      cost: null
    };
  }

  function hasRule(result, rule) {
    return (result.failures || []).some(function (failure) { return failure.rule === rule; });
  }

  var CHECKS = [
    {
      name: "Lipitor 20 mg matches Storvas and shows a 90-day landed cost",
      input: { name: "Lipitor", strength: "20 mg", form: "tablet", release: "IR" },
      pass: function (result) {
        return result.status === "exact" &&
          result.product.brand === "Storvas 20" &&
          result.cost &&
          result.cost.landedCents === 2700;
      }
    },
    {
      name: "Atorvastatin 20 mg resolves to the same Storvas listing",
      input: { name: "atorvastatin", strength: "20mg", form: "tablet", release: "IR" },
      pass: function (result) {
        return result.status === "exact" && result.product.id === "storvas-20";
      }
    },
    {
      name: "Synthroid 50 mcg matches Eltroxin",
      input: { name: "Synthroid", strength: "50 mcg", form: "tablet", release: "IR" },
      pass: function (result) {
        return result.status === "exact" && result.product.brand === "Eltroxin 50 mcg" && !!result.cost;
      }
    },
    {
      name: "Metoprolol tartrate 50 mg IR matches Metolar",
      input: { name: "metoprolol tartrate", strength: "50 mg", form: "tablet", release: "IR" },
      pass: function (result) {
        return result.status === "exact" && result.product.brand === "Metolar 50";
      }
    },
    {
      name: "Lipitor 40 mg is rejected for strength and has no price",
      input: { name: "Lipitor", strength: "40 mg", form: "tablet", release: "IR" },
      pass: function (result) {
        return result.status === "reject" && hasRule(result, "strength") && result.cost === null;
      }
    },
    {
      name: "Metoprolol succinate ER does not match tartrate IR",
      input: { name: "Metoprolol succinate", strength: "50 mg", form: "tablet", release: "ER" },
      pass: function (result) {
        return result.status === "reject" &&
          hasRule(result, "salt") &&
          hasRule(result, "release") &&
          result.cost === null;
      }
    },
    {
      name: "Metformin ER does not match immediate-release",
      input: { name: "metformin", strength: "500 mg", form: "tablet", release: "ER" },
      pass: function (result) {
        return result.status === "reject" && hasRule(result, "release") && !hasRule(result, "strength") && result.cost === null;
      }
    },
    {
      name: "Adderall is blocked and shows no seller",
      input: { name: "Adderall", strength: "20 mg", form: "tablet", release: "IR" },
      pass: function (result) {
        return result.status === "blocked" && result.product === null && result.cost === null;
      }
    },
    {
      name: "Insulin glargine is blocked and shows no seller",
      input: { name: "insulin glargine", strength: "100 units/ml", form: "injection", release: "IR" },
      pass: function (result) {
        return result.status === "blocked" && result.product === null && result.cost === null;
      }
    },
    {
      name: "Ibuprofen is not in the sample table",
      input: { name: "ibuprofen", strength: "200 mg", form: "tablet", release: "IR" },
      pass: function (result) {
        return result.status === "unknown" && result.cost === null;
      }
    }
  ];

  function runChecks() {
    return CHECKS.map(function (check) {
      var result = matchDrug(check.input);
      var passed = false;
      try {
        passed = !!check.pass(result);
      } catch (error) {
        passed = false;
      }
      return { name: check.name, passed: passed, status: result.status };
    });
  }

  window.MedFinder = {
    matchDrug: matchDrug,
    runChecks: runChecks,
    money: money,
    formatStrength: formatStrength
  };
})();
