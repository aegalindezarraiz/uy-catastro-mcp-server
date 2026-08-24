import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDueDiligenceBrief,
  normalizeDepartmentName,
  parseRuralRow,
  parseUrbanRow,
} from "../src/domain.js";

const departments = new Map([
  ["A", "CANELONES"],
  ["V", "MONTEVIDEO"],
]);
const localities = new Map([
  ["A:AA", "CANELONES"],
  ["A:AO", "JOANICO"],
]);

test("parseUrbanRow maps the documented DNC columns without inventing address or market value", () => {
  const record = parseUrbanRow(
    ["CO", "A", "AA", "1", "", "", "0", "1473", "438", "435014", "1805540", "2240554", "2240554", "/  /", "/  /"],
    departments,
    localities,
    "2026-08",
    "https://example.test/dnc.zip",
  );

  assert.deepEqual(record, {
    regime: "CO",
    department_code: "A",
    department: "CANELONES",
    locality_code: "AA",
    locality: "CANELONES",
    padron: "1",
    block: null,
    floor: null,
    unit: 0,
    section: null,
    area_land_m2: 1473,
    area_built_m2: 438,
    cadastral_land_value_uyu: 435014,
    cadastral_improvements_value_uyu: 1805540,
    cadastral_total_value_uyu: 2240554,
    taxable_value_uyu: 2240554,
    last_declaration_date: null,
    declaration_effective_date: null,
    snapshot: "2026-08",
    source_url: "https://example.test/dnc.zip",
  });
  assert.equal("address" in record, false);
  assert.equal("market_value" in record, false);
});

test("parseRuralRow maps section, surface and official cadastral values", () => {
  const record = parseRuralRow(
    ["V", "539", "17", "37545", "1016619", "1016619"],
    departments,
    "2026-08",
    "https://example.test/dnc.zip",
  );

  assert.equal(record.regime, "RU");
  assert.equal(record.department, "MONTEVIDEO");
  assert.equal(record.padron, "539");
  assert.equal(record.section, 17);
  assert.equal(record.area_land_m2, 37545);
  assert.equal(record.cadastral_total_value_uyu, 1016619);
});

test("normalizeDepartmentName accepts accents and common spacing variants", () => {
  assert.equal(normalizeDepartmentName("  Paysandú "), "PAYSANDU");
  assert.equal(normalizeDepartmentName("Río Negro"), "RIO NEGRO");
});

test("buildDueDiligenceBrief refuses an ambiguous reference", () => {
  const result = buildDueDiligenceBrief({
    query: { department: "CANELONES", padron: "1" },
    matches: [
      parseUrbanRow(["CO", "A", "AA", "1", "", "", "0", "1473", "438", "435014", "1805540", "2240554", "2240554", "", ""], departments, localities, "2026-08", "https://example.test/dnc.zip"),
      parseUrbanRow(["CO", "A", "AO", "1", "", "", "0", "500", "120", "100", "200", "300", "300", "", ""], departments, localities, "2026-08", "https://example.test/dnc.zip"),
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "ambiguous");
  assert.match(result.text, /localidad/i);
});
