import assert from "node:assert/strict";
import test from "node:test";

test("AVM module exposes the D3 estimator", async () => {
  const avm = await import("../src/avm.js").catch(() => ({}));
  assert.equal(typeof (avm as Record<string, unknown>).estimateAvm, "function");
});

test("AVM removes an absurd price-per-m2 outlier and estimates from valid witnesses", async () => {
  const { estimateAvm } = await import("../src/avm.js");
  const result = estimateAvm({
    valuation_date: "2026-08-24",
    subject: { property_type: "apartment", area_m2: 100, condition: "good" },
    comparables: [
      { id: "s1", source_kind: "sold", source_url: "https://evidence.test/s1", observed_at: "2026-06-01", price_usd: 195_000, area_m2: 98, property_type: "apartment", distance_m: 250, condition: "good" },
      { id: "s2", source_kind: "sold", source_url: "https://evidence.test/s2", observed_at: "2026-05-15", price_usd: 210_000, area_m2: 102, property_type: "apartment", distance_m: 400, condition: "good" },
      { id: "s3", source_kind: "sold", source_url: "https://evidence.test/s3", observed_at: "2026-04-10", price_usd: 205_000, area_m2: 100, property_type: "apartment", distance_m: 300, condition: "good" },
      { id: "s4", source_kind: "sold", source_url: "https://evidence.test/s4", observed_at: "2026-03-20", price_usd: 220_000, area_m2: 105, property_type: "apartment", distance_m: 550, condition: "good" },
      { id: "bad", source_kind: "listing", source_url: "https://evidence.test/bad", observed_at: "2026-06-10", price_usd: 99_000_000, area_m2: 100, property_type: "apartment", distance_m: 100, condition: "good" },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected an AVM result");
  assert.equal(result.comparables.used, 4);
  assert.equal(result.comparables.rejected, 1);
  assert.equal(result.comparables.rejected_items[0].id, "bad");
  assert.equal(result.comparables.rejected_items[0].reason, "price_per_m2_outlier");
  assert.ok(result.estimated_value_usd > 180_000 && result.estimated_value_usd < 240_000);
  assert.ok(result.range_usd.low < result.estimated_value_usd);
  assert.ok(result.range_usd.high > result.estimated_value_usd);
});

test("AVM rejects duplicates, mismatched property types and stale evidence before modeling", async () => {
  const { estimateAvm } = await import("../src/avm.js");
  const base = { source_kind: "sold" as const, observed_at: "2026-06-01", price_usd: 200_000, area_m2: 100, property_type: "apartment" as const };
  const result = estimateAvm({
    valuation_date: "2026-08-24",
    subject: { property_type: "apartment", area_m2: 100 },
    comparables: [
      { ...base, id: "one", source_url: "https://evidence.test/one" },
      { ...base, id: "two", source_url: "https://evidence.test/one" },
      { ...base, id: "house", source_url: "https://evidence.test/house", property_type: "house" },
      { ...base, id: "old", source_url: "https://evidence.test/old", observed_at: "2020-01-01" },
    ],
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected insufficient comparables");
  assert.equal(result.reason, "insufficient_comparables");
  assert.deepEqual(result.comparables.rejected_items.map((item) => item.reason), ["duplicate", "property_type_mismatch", "too_old"]);
});

test("AVM exposes source, time, condition, parking and environment adjustments", async () => {
  const { estimateAvm } = await import("../src/avm.js");
  const comparables = [1, 2, 3].map((number) => ({
    id: `l${number}`,
    source_kind: "listing" as const,
    source_url: `https://evidence.test/l${number}`,
    observed_at: "2025-08-24",
    price_usd: 200_000,
    area_m2: 100,
    property_type: "apartment" as const,
    distance_m: number * 100,
    condition: "good" as const,
    parking_spaces: 0,
    environment: { score: 60 },
  }));
  const result = estimateAvm({
    valuation_date: "2026-08-24",
    subject: { property_type: "apartment", area_m2: 100, condition: "excellent", parking_spaces: 1, environment: { score: 80 } },
    comparables,
    options: { listing_price_factor: 0.9, annual_market_trend_pct: 10, condition_step_pct: 5, parking_space_pct: 3, environment_point_pct: 0.2 },
  });

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected an AVM result");
  const factors = result.comparables.used_items[0].adjustments;
  assert.equal(factors.listing_factor, 0.9);
  assert.ok(Math.abs(factors.market_trend_factor - 1.1) < 0.001);
  assert.equal(factors.condition_factor, 1.05);
  assert.equal(factors.parking_factor, 1.03);
  assert.equal(factors.environment_factor, 1.04);
  assert.ok(result.estimated_value_usd > 210_000);
});

test("AVM adds a hedonic ridge model when enough comparable evidence is available", async () => {
  const { estimateAvm } = await import("../src/avm.js");
  const comparables = Array.from({ length: 12 }, (_, index) => {
    const area = 60 + index * 5;
    const bedrooms = 1 + index % 3;
    const bathrooms = 1 + index % 2;
    const parking = index % 2;
    return {
      id: `r${index}`,
      source_kind: "sold" as const,
      source_url: `https://evidence.test/r${index}`,
      observed_at: `2026-${String(1 + index % 7).padStart(2, "0")}-01`,
      price_usd: 45_000 + area * 1_350 + bedrooms * 11_000 + bathrooms * 8_000 + parking * 9_000,
      area_m2: area,
      property_type: "apartment" as const,
      bedrooms,
      bathrooms,
      parking_spaces: parking,
      condition: index % 4 === 0 ? "excellent" as const : "good" as const,
      distance_m: 150 + index * 80,
      environment: { score: 55 + index },
    };
  });
  const result = estimateAvm({
    valuation_date: "2026-08-24",
    subject: { property_type: "apartment", area_m2: 90, bedrooms: 2, bathrooms: 1, parking_spaces: 1, condition: "good", environment: { score: 65 } },
    comparables,
  });

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected an AVM result");
  assert.deepEqual(result.models_used, ["weighted_comparables", "hedonic_ridge"]);
  assert.equal(result.models.hedonic_ridge?.training_count, 12);
  assert.ok(Number.isFinite(result.models.hedonic_ridge?.estimate_usd));
  assert.ok(result.models.ensemble.estimate_usd > 100_000);
});

test("AVM caps confidence and warns when every witness is an asking price", async () => {
  const { estimateAvm } = await import("../src/avm.js");
  const comparables = Array.from({ length: 8 }, (_, index) => ({
    id: `a${index}`,
    source_kind: "listing" as const,
    source_url: `https://evidence.test/a${index}`,
    observed_at: "2026-07-01",
    price_usd: 180_000 + index * 2_000,
    area_m2: 90 + index,
    property_type: "apartment" as const,
    distance_m: 200 + index * 100,
  }));
  const result = estimateAvm({ valuation_date: "2026-08-24", subject: { property_type: "apartment", area_m2: 95 }, comparables });

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected an AVM result");
  assert.ok(result.confidence.score <= 60);
  assert.notEqual(result.confidence.grade, "high");
  assert.ok(result.warnings.some((warning) => /oferta/i.test(warning)));
  assert.match(result.disclaimer, /estimación automatizada orientativa/i);
});

test("AVM derives distance from coordinates and rejects witnesses outside the zone", async () => {
  const { estimateAvm } = await import("../src/avm.js");
  const near = [1, 2, 3].map((index) => ({
    id: `geo${index}`,
    source_kind: "sold" as const,
    source_url: `https://evidence.test/geo${index}`,
    observed_at: "2026-07-01",
    price_usd: 200_000 + index * 2_000,
    area_m2: 100,
    property_type: "apartment" as const,
    latitude: -34.901 + index * 0.001,
    longitude: -56.16,
  }));
  const result = estimateAvm({
    valuation_date: "2026-08-24",
    subject: { property_type: "apartment", area_m2: 100, latitude: -34.9, longitude: -56.16 },
    comparables: [...near, {
      id: "far",
      source_kind: "sold",
      source_url: "https://evidence.test/far",
      observed_at: "2026-07-01",
      price_usd: 210_000,
      area_m2: 100,
      property_type: "apartment",
      latitude: -34.96,
      longitude: -54.95,
    }],
    options: { max_distance_m: 20_000 },
  });

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected an AVM result");
  assert.equal(result.comparables.used, 3);
  assert.equal(result.comparables.rejected_items.find((item) => item.id === "far")?.reason, "too_far");
  assert.ok(result.comparables.used_items.every((item) => item.distance_m !== null));
});

test("AVM still removes a typo outlier when the normal MAD is zero", async () => {
  const { estimateAvm } = await import("../src/avm.js");
  const comparables = Array.from({ length: 5 }, (_, index) => ({
    id: `m${index}`,
    source_kind: "sold" as const,
    source_url: `https://evidence.test/m${index}`,
    observed_at: "2026-07-01",
    price_usd: 200_000,
    area_m2: index === 4 ? 1 : 100,
    property_type: "apartment" as const,
    distance_m: 100 + index,
  }));
  const result = estimateAvm({ valuation_date: "2026-08-24", subject: { property_type: "apartment", area_m2: 100 }, comparables });

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected an AVM result");
  assert.equal(result.comparables.used, 4);
  assert.equal(result.comparables.rejected_items[0].reason, "price_per_m2_outlier");
});
