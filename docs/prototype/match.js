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

  var SALT_WORDS = ["hydrochloride", "hcl", "succinate", "tartrate", "calcium", "sodium"];

  function canonicalSalt(value) {
    var text = normalizeName(value);
    if (text === "hcl") return "hydrochloride";
    return text;
  }

  function saltFromText(value) {
    var text = normalizeName(value);
    for (var i = 0; i < SALT_WORDS.length; i++) {
      if (nameHits(text, SALT_WORDS[i])) return canonicalSalt(SALT_WORDS[i]);
    }
    return "";
  }

  function ingredientKey(value) {
    var text = normalizeName(value);
    SALT_WORDS.forEach(function (salt) {
      text = text.replace(new RegExp("(^| )" + salt + "( |$)", "g"), " ");
    });
    return normalizeName(text);
  }

  function ingredientFromRxNorm(name) {
    var text = normalizeName(name).replace(/\[[^\]]*\]/g, " ");
    text = text.replace(/\d+(?:\.\d+)?\s*(mg|mcg|g|units\/ml).*/, " ");
    text = text.replace(/\b(oral|tablet|tablets|capsule|capsules|injection|extended|immediate|release|hr|hour)\b/g, " ");
    return ingredientKey(text);
  }

  function supplierStrength(row) {
    if (row && row.strength && row.strength.value != null) return row.strength;
    if (!row || row.strengthValue == null) return null;
    return { value: Number(row.strengthValue), unit: normalizeName(row.strengthUnit) };
  }

  function supplierCost(row) {
    var packs = Math.ceil((DAYS * 1) / row.packCount);
    var drug = packs * row.packPrice;
    var shipping = row.shippingAmount == null ? null : row.shippingAmount;
    return {
      days: DAYS,
      unitsPerDay: 1,
      units: DAYS,
      packs: packs,
      packCount: row.packCount,
      packPrice: row.packPrice,
      drug: roundMoney(drug),
      shipping: shipping == null ? null : roundMoney(shipping),
      landed: roundMoney(shipping == null ? drug : drug + shipping),
      shippingIncluded: shipping != null
    };
  }

  function roundMoney(value) {
    return Math.round(value * 100) / 100;
  }

  function prepareSupplier(row) {
    if (!row || typeof row !== "object") return null;
    var pageUrl = String(row.pageUrl || "");
    if (pageUrl.indexOf("https://") !== 0) return null;
    var packPrice = Number(row.packPrice);
    var packCount = Number(row.packCount);
    if (!isFinite(packPrice) || packPrice < 0 || !isFinite(packCount) || packCount <= 0) return null;
    var kind = normalizeName(row.shippingKind);
    if (kind !== "page" && kind !== "estimate" && kind !== "unstated") kind = "unstated";
    var shippingAmount = row.shippingAmount == null || row.shippingAmount === "" ? null : Number(row.shippingAmount);
    var basis = String(row.shippingBasis || "").trim();
    if (kind === "estimate" && !basis) kind = "unstated";
    if (kind === "unstated" || !isFinite(shippingAmount) || shippingAmount < 0) {
      kind = "unstated";
      shippingAmount = null;
      if (!basis) basis = "The seller page did not state a shipping figure.";
    }
    return {
      supplier: String(row.supplier || "").trim(),
      brand: String(row.brand || "").trim(),
      ingredient: ingredientKey(row.ingredient),
      salt: saltFromText(row.salt) || saltFromText(row.ingredient) || canonicalSalt(row.salt),
      strength: supplierStrength(row),
      form: normalizeForm(row.form),
      release: normalizeRelease(row.release),
      packCount: packCount,
      packPrice: packPrice,
      currency: normalizeName(row.currency).toUpperCase() || "INR",
      shippingAmount: shippingAmount,
      shippingKind: kind,
      shippingBasis: basis,
      pageUrl: pageUrl
    };
  }

  function usSupply(input, row) {
    var prepared = prepareSupplier(row);
    if (!prepared || prepared.currency !== "USD") return null;
    var strength = parseStrength(input && input.strength);
    var form = normalizeForm(input && input.form);
    var release = normalizeRelease(input && input.release);
    if (!sameStrength(strength, prepared.strength) || form !== prepared.form || release !== prepared.release) return null;
    prepared.cost = supplierCost(prepared);
    return prepared;
  }

  function filterSuppliers(input, suppliers, rxnormName) {
    var local = matchDrug(input || {});
    if (local.status === "blocked" || local.status === "invalid") {
      return { status: local.status, message: local.message, suppliers: [], failures: [], sample: local };
    }

    var strength = parseStrength(input && input.strength);
    var form = normalizeForm(input && input.form);
    var release = normalizeRelease(input && input.release);
    if (!strength || !form || !release) {
      return {
        status: "invalid",
        message: "Enter a strength such as 20 mg or 50 mcg, a dosage form, and IR or ER.",
        suppliers: [],
        failures: [],
        sample: local
      };
    }

    var identity = local.identity || null;
    var expectedSalt = (identity && identity.salt) || saltFromText(input && input.name) || saltFromText(rxnormName) || "";
    var expectedIngredient = (identity && identity.ingredient) || ingredientFromRxNorm(rxnormName) || ingredientKey(input && input.name);
    var accepted = [];
    var failures = [];

    (suppliers || []).forEach(function (candidate) {
      var row = prepareSupplier(candidate);
      if (!row) return;
      var rowFailures = [];
      if (!row.ingredient || !expectedIngredient || row.ingredient !== ingredientKey(expectedIngredient)) {
        rowFailures.push({ rule: "ingredient", detail: "Ingredient does not agree." });
      }
      if (expectedSalt && row.salt !== canonicalSalt(expectedSalt)) {
        rowFailures.push({
          rule: "salt",
          detail: "Salt form does not agree: " + (expectedSalt || "unspecified") + " is not " + (row.salt || "unspecified") + "."
        });
      }
      if (!sameStrength(strength, row.strength)) {
        rowFailures.push({
          rule: "strength",
          detail: "Strength does not agree: " + formatStrength(strength) + " is not " + formatStrength(row.strength) + "."
        });
      }
      if (form !== row.form) {
        rowFailures.push({ rule: "form", detail: "Dosage form does not agree: " + form + " is not " + row.form + "." });
      }
      if (release !== row.release) {
        rowFailures.push({ rule: "release", detail: "Release type does not agree: " + release + " is not " + row.release + "." });
      }
      if (rowFailures.length) {
        failures = failures.concat(rowFailures);
        return;
      }
      row.cost = supplierCost(row);
      accepted.push(row);
    });

    if (accepted.length) {
      return {
        status: "exact",
        message: "Exact match. Ingredient, salt form, strength, dosage form, and release type agree.",
        suppliers: accepted,
        failures: [],
        sample: local
      };
    }

    if (failures.length) {
      var unique = [];
      failures.forEach(function (failure) {
        if (!unique.some(function (item) { return item.detail === failure.detail; })) unique.push(failure);
      });
      return {
        status: "reject",
        message: "Not a match. " + unique.map(function (failure) { return failure.detail; }).join(" "),
        suppliers: [],
        failures: unique,
        sample: local
      };
    }

    return {
      status: "none",
      message: "No live supplier page was returned.",
      suppliers: [],
      failures: [],
      sample: local
    };
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
    },
    {
      name: "A live 20 mg atorvastatin row is priced and a 40 mg row is not",
      input: { name: "Lipitor", strength: "20 mg", form: "tablet", release: "IR" },
      run: function () {
        var result = filterSuppliers(
          { name: "Lipitor", strength: "20 mg", form: "tablet", release: "IR" },
          [
            supplierRow(20, "https://example.com/storvas-20"),
            supplierRow(40, "https://example.com/storvas-40")
          ],
          "atorvastatin 20 MG Oral Tablet [Lipitor]"
        );
        return result.suppliers.length === 1 &&
          result.suppliers[0].strength.value === 20 &&
          result.suppliers[0].cost.landed === 38 &&
          result.suppliers[0].cost.shippingIncluded;
      }
    },
    {
      name: "A live succinate ER row is rejected for a tartrate IR request",
      input: { name: "metoprolol tartrate", strength: "50 mg", form: "tablet", release: "IR" },
      run: function () {
        var result = filterSuppliers(
          { name: "metoprolol tartrate", strength: "50 mg", form: "tablet", release: "IR" },
          [{
            supplier: "Example Pharmacy",
            brand: "Seloken XL",
            ingredient: "metoprolol",
            salt: "succinate",
            strength: { value: 50, unit: "mg" },
            form: "tablet",
            release: "ER",
            packCount: 10,
            packPrice: 4,
            currency: "USD",
            shippingAmount: 2,
            shippingKind: "page",
            shippingBasis: "Stated on the product page.",
            pageUrl: "https://example.com/seloken"
          }],
          "metoprolol succinate"
        );
        return result.status === "reject" && result.suppliers.length === 0 && hasRule(result, "salt") && hasRule(result, "release");
      }
    },
    {
      name: "Adderall is blocked before any supplier row is priced",
      input: { name: "Adderall", strength: "20 mg", form: "tablet", release: "IR" },
      run: function () {
        var result = filterSuppliers(
          { name: "Adderall", strength: "20 mg", form: "tablet", release: "IR" },
          [supplierRow(20, "https://example.com/adderall")],
          "amphetamine"
        );
        return result.status === "blocked" && result.suppliers.length === 0;
      }
    },
    {
      name: "A US price is kept for the same strength and the 90-unit cost is calculated",
      input: { name: "Lipitor", strength: "20 mg", form: "tablet", release: "IR" },
      run: function () {
        var kept = usSupply(
          { name: "Lipitor", strength: "20 mg", form: "tablet", release: "IR" },
          {
            supplier: "Cost Plus",
            brand: "Atorvastatin",
            ingredient: "atorvastatin",
            salt: "calcium",
            strength: { value: 20, unit: "mg" },
            form: "tablet",
            release: "IR",
            packCount: 30,
            packPrice: 6,
            currency: "USD",
            shippingKind: "unstated",
            pageUrl: "https://example.com/us"
          }
        );
        var dropped = usSupply(
          { name: "Lipitor", strength: "20 mg", form: "tablet", release: "IR" },
          {
            supplier: "Cost Plus",
            brand: "Atorvastatin",
            ingredient: "atorvastatin",
            salt: "calcium",
            strength: { value: 40, unit: "mg" },
            form: "tablet",
            release: "IR",
            packCount: 30,
            packPrice: 6,
            currency: "USD",
            shippingKind: "unstated",
            pageUrl: "https://example.com/us-40"
          }
        );
        return !!kept && kept.cost.units === 90 && kept.cost.packs === 3 && kept.cost.landed === 18 && dropped === null;
      }
    },
    {
      name: "A supplier row without an https page is dropped",
      input: { name: "Lipitor", strength: "20 mg", form: "tablet", release: "IR" },
      run: function () {
        var result = filterSuppliers(
          { name: "Lipitor", strength: "20 mg", form: "tablet", release: "IR" },
          [supplierRow(20, "")],
          "atorvastatin 20 MG Oral Tablet [Lipitor]"
        );
        return result.suppliers.length === 0;
      }
    }
  ];

  function supplierRow(strength, pageUrl) {
    return {
      supplier: "Example Pharmacy",
      brand: "Storvas " + strength,
      ingredient: "atorvastatin",
      salt: "calcium",
      strength: { value: strength, unit: "mg" },
      form: "tablet",
      release: "IR",
      packCount: 10,
      packPrice: 4,
      currency: "USD",
      shippingAmount: 2,
      shippingKind: "page",
      shippingBasis: "Stated on the product page.",
      pageUrl: pageUrl
    };
  }

  function runChecks() {
    return CHECKS.map(function (check) {
      var result = matchDrug(check.input);
      var passed = false;
      try {
        passed = check.run ? !!check.run() : !!check.pass(result);
      } catch (error) {
        passed = false;
      }
      return { name: check.name, passed: passed, status: result.status };
    });
  }

  window.MedFinder = {
    matchDrug: matchDrug,
    filterSuppliers: filterSuppliers,
    usSupply: usSupply,
    runChecks: runChecks,
    money: money,
    formatStrength: formatStrength
  };
})();
