export type PropertyType = "apartment" | "house" | "land" | "commercial" | "other";
export type PropertyCondition = "new" | "excellent" | "good" | "fair" | "poor" | "unknown";
export type SourceKind = "sold" | "listing";

export type EnvironmentSnapshot = {
  schools_1km?: number;
  transit_stops_500m?: number;
  parks_1km?: number;
  shops_1km?: number;
  crime_index?: number;
  score?: number;
  measured_at?: string;
  source_urls?: string[];
};

export type AvmProperty = {
  property_type: PropertyType;
  area_m2: number;
  bedrooms?: number;
  bathrooms?: number;
  parking_spaces?: number;
  construction_year?: number;
  condition?: PropertyCondition;
  latitude?: number;
  longitude?: number;
  environment?: EnvironmentSnapshot;
};

export type AvmComparable = AvmProperty & {
  id: string;
  source_kind: SourceKind;
  source_url: string;
  observed_at: string;
  price_usd: number;
  distance_m?: number;
};

export type AvmOptions = {
  listing_price_factor?: number;
  annual_market_trend_pct?: number;
  size_elasticity?: number;
  condition_step_pct?: number;
  parking_space_pct?: number;
  environment_point_pct?: number;
  max_age_months?: number;
  max_distance_m?: number;
};

export type AvmInput = {
  valuation_date?: string;
  subject: AvmProperty;
  comparables: AvmComparable[];
  options?: AvmOptions;
};

type RejectedComparable = { id: string; reason: string; detail: string };

const DEFAULTS = {
  listing_price_factor: 0.95,
  annual_market_trend_pct: 0,
  size_elasticity: -0.15,
  condition_step_pct: 3,
  parking_space_pct: 2,
  environment_point_pct: 0.15,
  max_age_months: 36,
  max_distance_m: 20_000,
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function monthsBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / (30.4375 * 24 * 60 * 60 * 1000));
}

function haversineMeters(from: AvmProperty, to: AvmProperty): number | undefined {
  if (from.latitude === undefined || from.longitude === undefined || to.latitude === undefined || to.longitude === undefined) return undefined;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function weightedMedian(values: Array<{ value: number; weight: number }>): number {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  let accumulated = 0;
  for (const item of sorted) {
    accumulated += item.weight;
    if (accumulated >= total / 2) return item.value;
  }
  return sorted.at(-1)?.value ?? 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function conditionScore(value: PropertyCondition | undefined): number | null {
  if (!value || value === "unknown") return null;
  return { poor: 1, fair: 2, good: 3, excellent: 4, new: 5 }[value];
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < matrix.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < matrix.length; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= matrix.length; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < matrix.length; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= matrix.length; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map((row) => row[matrix.length]);
}

type RegressionObservation = {
  property: AvmProperty;
  normalizedPrice: number;
  weight: number;
};

function hedonicRidge(subject: AvmProperty, observations: RegressionObservation[]) {
  if (observations.length < 8) return null;
  const featureCandidates = [
    { name: "log_area_m2", get: (property: AvmProperty) => Math.log(property.area_m2) },
    { name: "bedrooms", get: (property: AvmProperty) => property.bedrooms },
    { name: "bathrooms", get: (property: AvmProperty) => property.bathrooms },
    { name: "parking_spaces", get: (property: AvmProperty) => property.parking_spaces },
    { name: "construction_year", get: (property: AvmProperty) => property.construction_year },
    { name: "condition_score", get: (property: AvmProperty) => conditionScore(property.condition) ?? undefined },
    { name: "environment_score", get: (property: AvmProperty) => environmentScore(property.environment) ?? undefined },
  ];
  const selected = featureCandidates.flatMap((feature) => {
    const subjectValue = feature.get(subject);
    const available = observations.map((item) => feature.get(item.property)).filter((value): value is number => value !== undefined && Number.isFinite(value));
    if (subjectValue === undefined || available.length < Math.ceil(observations.length * 0.7)) return [];
    const fill = median(available);
    const values = observations.map((item) => feature.get(item.property) ?? fill);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    if (deviation < 1e-9) return [];
    return [{ ...feature, subjectValue, fill, values, mean, deviation }];
  });
  if (selected.length === 0) return null;

  const rows = observations.map((_, rowIndex) => [1, ...selected.map((feature) => (feature.values[rowIndex] - feature.mean) / feature.deviation)]);
  const targets = observations.map((item) => Math.log(item.normalizedPrice));
  const size = rows[0].length;
  const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  const vector = Array.from({ length: size }, () => 0);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const weight = observations[rowIndex].weight;
    for (let left = 0; left < size; left += 1) {
      vector[left] += weight * rows[rowIndex][left] * targets[rowIndex];
      for (let right = 0; right < size; right += 1) matrix[left][right] += weight * rows[rowIndex][left] * rows[rowIndex][right];
    }
  }
  const lambda = 1;
  for (let index = 1; index < size; index += 1) matrix[index][index] += lambda;
  const coefficients = solveLinearSystem(matrix, vector);
  if (!coefficients) return null;
  const subjectRow = [1, ...selected.map((feature) => (feature.subjectValue - feature.mean) / feature.deviation)];
  const prediction = Math.exp(subjectRow.reduce((sum, value, index) => sum + value * coefficients[index], 0));
  if (!Number.isFinite(prediction) || prediction <= 0) return null;
  return {
    estimate_usd: Math.round(prediction),
    training_count: observations.length,
    features: selected.map((feature) => feature.name),
    regularization_lambda: lambda,
  };
}

export function environmentScore(snapshot: EnvironmentSnapshot | undefined): number | null {
  if (!snapshot) return null;
  if (snapshot.score !== undefined && Number.isFinite(snapshot.score)) return clamp(snapshot.score, 0, 100);
  const metrics = [
    snapshot.schools_1km === undefined ? null : clamp(snapshot.schools_1km / 10 * 100, 0, 100),
    snapshot.transit_stops_500m === undefined ? null : clamp(snapshot.transit_stops_500m / 20 * 100, 0, 100),
    snapshot.parks_1km === undefined ? null : clamp(snapshot.parks_1km / 5 * 100, 0, 100),
    snapshot.shops_1km === undefined ? null : clamp(snapshot.shops_1km / 30 * 100, 0, 100),
    snapshot.crime_index === undefined ? null : clamp(100 - snapshot.crime_index, 0, 100),
  ].filter((value): value is number => value !== null);
  return metrics.length > 0 ? metrics.reduce((sum, value) => sum + value, 0) / metrics.length : null;
}

export function estimateAvm(input: AvmInput) {
  const valuationDate = new Date(`${input.valuation_date ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const options = { ...DEFAULTS, ...input.options };
  const rejectedItems: RejectedComparable[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const normalizedComparables = input.comparables.map((comparable) => ({
    ...comparable,
    distance_m: haversineMeters(input.subject, comparable) ?? comparable.distance_m,
  }));
  let candidates = normalizedComparables.filter((comparable) => {
    let reason = "";
    if (!comparable.id || !comparable.source_url) reason = "missing_evidence";
    else if (seenIds.has(comparable.id) || seenUrls.has(comparable.source_url)) reason = "duplicate";
    else if (comparable.property_type !== input.subject.property_type) reason = "property_type_mismatch";
    else if (!Number.isFinite(comparable.price_usd) || comparable.price_usd <= 0 || !Number.isFinite(comparable.area_m2) || comparable.area_m2 <= 0) reason = "invalid_price_or_area";
    else {
      const observed = new Date(`${comparable.observed_at}T00:00:00Z`);
      if (Number.isNaN(observed.getTime()) || observed.getTime() > valuationDate.getTime() + 7 * 86_400_000) reason = "invalid_or_future_date";
      else if (monthsBetween(observed, valuationDate) > options.max_age_months) reason = "too_old";
      else if (comparable.distance_m !== undefined && comparable.distance_m > options.max_distance_m) reason = "too_far";
    }
    if (reason) {
      rejectedItems.push({ id: comparable.id || "unknown", reason, detail: "Rejected before modeling" });
      return false;
    }
    seenIds.add(comparable.id);
    seenUrls.add(comparable.source_url);
    return true;
  });

  if (candidates.length >= 5) {
    const rates = candidates.map((item) => item.price_usd / item.area_m2);
    const center = median(rates);
    const mad = median(rates.map((value) => Math.abs(value - center)));
    candidates = candidates.filter((item) => {
      const rate = item.price_usd / item.area_m2;
      const robustZ = mad > 0 ? 0.6745 * Math.abs(rate - center) / mad : null;
      const isOutlier = robustZ === null ? rate < center / 3 || rate > center * 3 : robustZ > 3.5;
      if (!isOutlier) return true;
      const detail = robustZ === null ? "Outside 0.33–3.00x the common median" : `Robust z-score ${robustZ.toFixed(2)}`;
      rejectedItems.push({ id: item.id, reason: "price_per_m2_outlier", detail });
      return false;
    });
  }

  if (candidates.length < 3) {
    return {
      ok: false as const,
      reason: "insufficient_comparables" as const,
      comparables: { submitted: input.comparables.length, used: candidates.length, rejected: rejectedItems.length, rejected_items: rejectedItems },
    };
  }

  const usedItems = candidates.map((item) => {
    const observed = new Date(`${item.observed_at}T00:00:00Z`);
    const ageMonths = monthsBetween(observed, valuationDate);
    const sourceFactor = item.source_kind === "listing" ? options.listing_price_factor : 1;
    const trendFactor = Math.pow(1 + options.annual_market_trend_pct / 100, ageMonths / 12);
    const sizeFactor = Math.pow(input.subject.area_m2 / item.area_m2, options.size_elasticity);
    const subjectCondition = conditionScore(input.subject.condition);
    const comparableCondition = conditionScore(item.condition);
    const conditionFactor = subjectCondition === null || comparableCondition === null
      ? 1
      : clamp(1 + (subjectCondition - comparableCondition) * options.condition_step_pct / 100, 0.75, 1.25);
    const parkingFactor = input.subject.parking_spaces === undefined || item.parking_spaces === undefined
      ? 1
      : clamp(1 + (input.subject.parking_spaces - item.parking_spaces) * options.parking_space_pct / 100, 0.75, 1.25);
    const subjectEnvironment = environmentScore(input.subject.environment);
    const comparableEnvironment = environmentScore(item.environment);
    const environmentFactor = subjectEnvironment === null || comparableEnvironment === null
      ? 1
      : clamp(1 + (subjectEnvironment - comparableEnvironment) * options.environment_point_pct / 100, 0.75, 1.25);
    const adjustedPriceM2 = item.price_usd / item.area_m2 * sourceFactor * trendFactor * sizeFactor * conditionFactor * parkingFactor * environmentFactor;
    const adjustedValue = adjustedPriceM2 * input.subject.area_m2;
    const distanceWeight = item.distance_m === undefined ? 0.5 : 1 / (1 + item.distance_m / 2_000);
    const recencyWeight = Math.exp(-ageMonths / 18);
    const similarityWeight = Math.exp(-Math.abs(Math.log(item.area_m2 / input.subject.area_m2)));
    const sourceWeight = item.source_kind === "sold" ? 1 : 0.7;
    return {
      id: item.id,
      source_kind: item.source_kind,
      source_url: item.source_url,
      distance_m: item.distance_m ?? null,
      adjusted_value_usd: Math.round(adjustedValue),
      normalized_price_usd: Math.round(item.price_usd * sourceFactor * trendFactor),
      adjusted_price_m2_usd: Math.round(adjustedPriceM2),
      weight: sourceWeight * distanceWeight * recencyWeight * similarityWeight,
      adjustments: {
        listing_factor: sourceFactor,
        market_trend_factor: trendFactor,
        size_factor: sizeFactor,
        condition_factor: conditionFactor,
        parking_factor: parkingFactor,
        environment_factor: environmentFactor,
      },
    };
  });
  const comparablesEstimate = weightedMedian(usedItems.map((item) => ({ value: item.adjusted_value_usd, weight: item.weight })));
  const itemsById = new Map(candidates.map((item) => [item.id, item]));
  const ridge = hedonicRidge(input.subject, usedItems.map((item) => ({
    property: itemsById.get(item.id) as AvmComparable,
    normalizedPrice: item.normalized_price_usd,
    weight: item.weight,
  })));
  const ridgeEstimate = ridge ? clamp(ridge.estimate_usd, comparablesEstimate * 0.5, comparablesEstimate * 2) : null;
  const estimate = ridgeEstimate === null ? comparablesEstimate : comparablesEstimate * 0.75 + ridgeEstimate * 0.25;
  const absoluteDeviations = usedItems.map((item) => Math.abs(item.adjusted_value_usd - estimate));
  const relativeSpread = estimate > 0 ? 1.4826 * median(absoluteDeviations) / estimate : 0;
  const intervalPct = Math.max(0.08, Math.min(0.4, relativeSpread * 1.28));
  const soldCount = candidates.filter((item) => item.source_kind === "sold").length;
  const soldRatio = soldCount / candidates.length;
  const ages = candidates.map((item) => monthsBetween(new Date(`${item.observed_at}T00:00:00Z`), valuationDate));
  const distances = candidates.flatMap((item) => item.distance_m === undefined ? [] : [item.distance_m]);
  let confidenceScore = Math.min(35, candidates.length / 10 * 35)
    + soldRatio * 20
    + Math.max(0, 1 - median(ages) / options.max_age_months) * 15
    + (distances.length > 0 ? Math.max(0, 1 - median(distances) / options.max_distance_m) * 10 : 0)
    + Math.max(0, 1 - relativeSpread / 0.3) * 20;
  if (soldCount === 0) confidenceScore = Math.min(confidenceScore, 60);
  if (candidates.length < 5) confidenceScore = Math.min(confidenceScore, 55);
  if (distances.length === 0) confidenceScore = Math.min(confidenceScore, 75);
  confidenceScore = Math.round(clamp(confidenceScore, 0, 100));
  const confidenceGrade = confidenceScore >= 80 && soldRatio >= 0.5 && candidates.length >= 8
    ? "high"
    : confidenceScore >= 55 ? "medium" : "low";
  const warnings = [
    ...(soldCount === 0 ? ["Todos los testigos son precios de oferta; no hay evidencia de ventas cerradas y la confianza está limitada."] : []),
    ...(distances.length < candidates.length ? ["Uno o más testigos no tienen distancia; su peso fue penalizado."] : []),
    ...(environmentScore(input.subject.environment) === null ? ["No se aportó un snapshot del entorno para el inmueble sujeto."] : []),
    ...(!ridge ? ["La muestra no permitió activar la regresión hedónica ridge; se usó solo el enfoque por comparables."] : []),
  ];

  return {
    ok: true as const,
    model_version: "D3-AVM-0.1",
    valuation_date: input.valuation_date ?? valuationDate.toISOString().slice(0, 10),
    currency: "USD" as const,
    estimated_value_usd: Math.round(estimate),
    estimated_price_m2_usd: Math.round(estimate / input.subject.area_m2),
    range_usd: { low: Math.round(estimate * (1 - intervalPct)), high: Math.round(estimate * (1 + intervalPct)), confidence_level: "80%" as const },
    comparables: {
      submitted: input.comparables.length,
      used: usedItems.length,
      rejected: rejectedItems.length,
      used_items: usedItems,
      rejected_items: rejectedItems,
    },
    models_used: ridge ? ["weighted_comparables", "hedonic_ridge"] : ["weighted_comparables"],
    models: {
      weighted_comparables: { estimate_usd: Math.round(comparablesEstimate), method: "weighted_median" as const },
      hedonic_ridge: ridge ? { ...ridge, estimate_usd: Math.round(ridgeEstimate as number) } : null,
      ensemble: { estimate_usd: Math.round(estimate), weights: ridge ? { weighted_comparables: 0.75, hedonic_ridge: 0.25 } : { weighted_comparables: 1 } },
    },
    confidence: { score: confidenceScore, grade: confidenceGrade, sold_witness_ratio: soldRatio },
    warnings,
    disclaimer: "Estimación automatizada orientativa; no es una tasación, certificado ni garantía del precio de cierre.",
    assumptions: options,
  };
}
