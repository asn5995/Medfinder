// Fictional sellers and past reviews for the local demo. These are not live pharmacy ratings.

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MedFinderSellers = api;
})(typeof window !== "undefined" ? window : null, function () {
  var SELLERS = [
    {
      id: "apollo",
      name: "Apollo Pharmacy",
      city: "Hyderabad",
      note: "Long record of packs that match the listed strength.",
      ratings: [5, 5, 4, 5, 4, 5, 4, 5, 5, 4, 5, 3, 5, 4, 5, 4, 5, 5, 4, 5],
      assignedCount: 48,
      fulfilledCount: 46
    },
    {
      id: "netmeds",
      name: "Netmeds",
      city: "Chennai",
      note: "Steady ratings and most assigned orders fulfilled.",
      ratings: [4, 4, 5, 4, 3, 4, 4, 5, 4, 4, 4, 3],
      assignedCount: 30,
      fulfilledCount: 27
    },
    {
      id: "pharmeasy",
      name: "PharmEasy",
      city: "Mumbai",
      note: "Solid ratings, with a few missed fulfillments.",
      ratings: [5, 4, 4, 5, 4, 3, 4, 4, 5, 2, 4, 4, 5, 4],
      assignedCount: 22,
      fulfilledCount: 18
    },
    {
      id: "newchem",
      name: "NewChem",
      city: "Pune",
      note: "One 5-star review. The prior keeps this seller below a longer record.",
      ratings: [5],
      assignedCount: 1,
      fulfilledCount: 1
    },
    {
      id: "citymed",
      name: "CityMed",
      city: "Delhi",
      note: "No reviews yet. Ranking uses the prior until orders arrive.",
      ratings: [],
      assignedCount: 0,
      fulfilledCount: 0
    },
    {
      id: "medplus",
      name: "MedPlus",
      city: "Hyderabad",
      note: "Mixed reviews and more unfulfilled assignments.",
      ratings: [3, 2, 4, 3, 3, 2, 5, 3, 1, 4],
      assignedCount: 20,
      fulfilledCount: 12
    }
  ];

  function list() {
    return SELLERS.map(function (seller) {
      return {
        id: seller.id,
        name: seller.name,
        city: seller.city,
        note: seller.note,
        ratings: seller.ratings.slice(),
        assignedCount: seller.assignedCount,
        fulfilledCount: seller.fulfilledCount
      };
    });
  }

  return { list: list };
});
