// Sample catalog for the local demo. Prices are illustrations, not live listings.
// A match is decided in match.js, not by this file.

window.MEDFINDER_IDENTITIES = [
  {
    names: ["lipitor", "atorvastatin"],
    ingredient: "atorvastatin",
    salt: "calcium"
  },
  {
    names: ["synthroid", "levothyroxine"],
    ingredient: "levothyroxine",
    salt: "sodium"
  },
  {
    names: ["glucophage", "metformin"],
    ingredient: "metformin",
    salt: "hydrochloride"
  },
  {
    names: ["toprol xl", "metoprolol succinate"],
    ingredient: "metoprolol",
    salt: "succinate"
  },
  {
    names: ["lopressor", "metoprolol tartrate"],
    ingredient: "metoprolol",
    salt: "tartrate"
  },
  {
    names: ["metoprolol"],
    ingredient: "metoprolol",
    salt: null
  },
  {
    names: ["adderall", "amphetamine salts", "mixed amphetamine salts"],
    ingredient: "amphetamine salts",
    salt: null,
    blocked: "controlled",
    blockReason: "MedFinder does not suggest a source for controlled substances."
  },
  {
    names: ["lantus", "insulin glargine", "insulin"],
    ingredient: "insulin glargine",
    salt: null,
    blocked: "refrigerated",
    blockReason: "MedFinder does not suggest a source for insulin or other refrigerated biologics."
  }
];

window.MEDFINDER_PRODUCTS = [
  {
    id: "storvas-20",
    ingredient: "atorvastatin",
    salt: "calcium",
    strength: { value: 20, unit: "mg" },
    form: "tablet",
    release: "IR",
    brand: "Storvas 20",
    manufacturer: "Sun Pharma",
    packCount: 30,
    packPriceCents: 400,
    shippingCents: 1500,
    us90DayCents: 24900,
    unitsPerDay: 1
  },
  {
    id: "eltroxin-50",
    ingredient: "levothyroxine",
    salt: "sodium",
    strength: { value: 50, unit: "mcg" },
    form: "tablet",
    release: "IR",
    brand: "Eltroxin 50 mcg",
    manufacturer: "GSK",
    packCount: 30,
    packPriceCents: 300,
    shippingCents: 1500,
    us90DayCents: 8700,
    unitsPerDay: 1
  },
  {
    id: "glycomet-500",
    ingredient: "metformin",
    salt: "hydrochloride",
    strength: { value: 500, unit: "mg" },
    form: "tablet",
    release: "IR",
    brand: "Glycomet 500",
    manufacturer: "USV",
    packCount: 20,
    packPriceCents: 200,
    shippingCents: 1500,
    us90DayCents: 1500,
    unitsPerDay: 1
  },
  {
    id: "metolar-50",
    ingredient: "metoprolol",
    salt: "tartrate",
    strength: { value: 50, unit: "mg" },
    form: "tablet",
    release: "IR",
    brand: "Metolar 50",
    manufacturer: "Cipla",
    packCount: 10,
    packPriceCents: 150,
    shippingCents: 1500,
    us90DayCents: 4200,
    unitsPerDay: 1
  }
];
