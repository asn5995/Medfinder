// Seller ranking. A short record is pulled toward a prior so one 5-star rating
// does not outrank a seller with a longer history. See the README for the formula.

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MedFinderRanking = api;
})(typeof window !== "undefined" ? window : null, function () {
  // Eight imaginary ratings at 3.5 stars, and six imaginary orders at 80% fulfilled.
  var PRIOR_MEAN = 3.5;
  var PRIOR_COUNT = 8;
  var RELIABILITY_PRIOR = 0.8;
  var RELIABILITY_COUNT = 6;
  var RATING_WEIGHT = 0.7;
  var RELIABILITY_WEIGHT = 0.3;

  function starValue(value) {
    if (typeof value === "number") return value;
    if (value && typeof value.stars === "number") return value.stars;
    return null;
  }

  function scoreSeller(seller) {
    var source = seller || {};
    var ratings = (source.ratings || []).map(starValue).filter(function (value) {
      return typeof value === "number" && isFinite(value) && value >= 1 && value <= 5;
    });
    var sum = 0;
    ratings.forEach(function (value) { sum += value; });
    var count = ratings.length;
    var ratingAverage = (PRIOR_COUNT * PRIOR_MEAN + sum) / (PRIOR_COUNT + count);
    var assigned = Number(source.assignedCount);
    var fulfilled = Number(source.fulfilledCount);
    if (!isFinite(assigned) || assigned < 0) assigned = 0;
    if (!isFinite(fulfilled) || fulfilled < 0) fulfilled = 0;
    if (fulfilled > assigned) fulfilled = assigned;
    var reliability = (RELIABILITY_COUNT * RELIABILITY_PRIOR + fulfilled) / (RELIABILITY_COUNT + assigned);
    var rankingScore = RATING_WEIGHT * (ratingAverage / 5) + RELIABILITY_WEIGHT * reliability;
    return {
      id: source.id,
      name: source.name || "",
      city: source.city || "",
      note: source.note || "",
      ratings: (source.ratings || []).slice(),
      assignedCount: assigned,
      fulfilledCount: fulfilled,
      ratingCount: count,
      ratingAverage: ratingAverage,
      rawAverage: count ? sum / count : null,
      reliability: reliability,
      rankingScore: rankingScore
    };
  }

  function rankSellers(sellers) {
    return (sellers || []).map(scoreSeller).sort(function (left, right) {
      if (right.rankingScore !== left.rankingScore) return right.rankingScore - left.rankingScore;
      var name = String(left.name).localeCompare(String(right.name));
      if (name) return name;
      return String(left.id).localeCompare(String(right.id));
    });
  }

  function orderShares(sellers) {
    var ranked = rankSellers(sellers);
    var total = 0;
    ranked.forEach(function (seller) { total += seller.rankingScore; });
    return ranked.map(function (seller) {
      var share = total > 0 ? seller.rankingScore / total : (ranked.length ? 1 / ranked.length : 0);
      return Object.assign({}, seller, { share: share });
    });
  }

  function assignSeller(sellers, random) {
    var ranked = orderShares(sellers);
    if (!ranked.length) return null;
    var roll = typeof random === "function" ? Number(random()) : Math.random();
    if (!isFinite(roll) || roll < 0) roll = 0;
    if (roll >= 1) roll = 0.999999;
    var cursor = 0;
    for (var i = 0; i < ranked.length; i++) {
      cursor += ranked[i].share;
      if (roll < cursor) return ranked[i];
    }
    return ranked[ranked.length - 1];
  }

  return {
    PRIOR_MEAN: PRIOR_MEAN,
    PRIOR_COUNT: PRIOR_COUNT,
    RELIABILITY_PRIOR: RELIABILITY_PRIOR,
    RELIABILITY_COUNT: RELIABILITY_COUNT,
    RATING_WEIGHT: RATING_WEIGHT,
    RELIABILITY_WEIGHT: RELIABILITY_WEIGHT,
    scoreSeller: scoreSeller,
    rankSellers: rankSellers,
    orderShares: orderShares,
    assignSeller: assignSeller
  };
});
