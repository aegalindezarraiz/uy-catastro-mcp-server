import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { CatastroStore, createSchema } from "../src/store.js";

function makeStore() {
  const directory = mkdtempSync(join(tmpdir(), "catastro-store-"));
  const databasePath = join(directory, "catastro.sqlite");
  const db = new Database(databasePath);
  createSchema(db);
  db.prepare("INSERT INTO departments (code, name) VALUES (?, ?)").run("A", "CANELONES");
  db.prepare("INSERT INTO departments (code, name) VALUES (?, ?)").run("V", "MONTEVIDEO");
  db.prepare("INSERT INTO localities (department_code, code, name) VALUES (?, ?, ?)").run("A", "AA", "CANELONES");
  db.prepare("INSERT INTO localities (department_code, code, name) VALUES (?, ?, ?)").run("A", "AO", "JOANICO");
  db.prepare(`INSERT INTO dataset_manifest
    (snapshot, published_at, resource_id, source_url, urban_records, rural_records, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("2026-08", "2026-08-07T18:01:17.687050", "resource-08", "https://example.test/dnc.zip", 2, 1, "2026-08-24T00:00:00.000Z");

  const insert = db.prepare(`INSERT INTO records (
    regime, department_code, locality_code, padron, block, floor, unit, section,
    area_land_m2, area_built_m2, cadastral_land_value_uyu, cadastral_improvements_value_uyu,
    cadastral_total_value_uyu, taxable_value_uyu, last_declaration_date, declaration_effective_date
  ) VALUES (@regime, @department_code, @locality_code, @padron, @block, @floor,
    @unit, @section, @area_land_m2, @area_built_m2, @cadastral_land_value_uyu,
    @cadastral_improvements_value_uyu, @cadastral_total_value_uyu, @taxable_value_uyu,
    @last_declaration_date, @declaration_effective_date)`);
  const base = {
    block: null, floor: null, unit: 0, section: null, area_land_m2: 100, area_built_m2: 50,
    cadastral_land_value_uyu: 10, cadastral_improvements_value_uyu: 20,
    cadastral_total_value_uyu: 30, taxable_value_uyu: 30, last_declaration_date: null,
    declaration_effective_date: null,
  };
  insert.run({ ...base, regime: "CO", department_code: "A", locality_code: "AA", padron: 1 });
  insert.run({ ...base, regime: "CO", department_code: "A", locality_code: "AO", padron: 1 });
  insert.run({ ...base, regime: "RU", department_code: "V", locality_code: null, padron: 539, section: 17 });
  db.close();

  return { directory, store: new CatastroStore(databasePath) };
}

test("lookup returns every candidate when department and padron are ambiguous", () => {
  const { directory, store } = makeStore();
  try {
    const result = store.lookup({ department: "Canelones", padron: "1" });
    assert.equal(result.found, true);
    assert.equal(result.ambiguous, true);
    assert.equal(result.matches.length, 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("lookup resolves an urban record by locality name", () => {
  const { directory, store } = makeStore();
  try {
    const result = store.lookup({ department: "CANELONES", padron: "1", locality: "Joanicó" });
    assert.equal(result.ambiguous, false);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].locality, "JOANICO");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("lookup resolves a rural record by cadastral section", () => {
  const { directory, store } = makeStore();
  try {
    const result = store.lookup({ department: "Montevideo", padron: "539", regime: "RU", section: 17 });
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].regime, "RU");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dataset status exposes the official snapshot and record counts", () => {
  const { directory, store } = makeStore();
  try {
    const status = store.getStatus();
    assert.equal(status.mode, "official_snapshot");
    assert.equal(status.snapshot, "2026-08");
    assert.equal(status.records_loaded, 3);
    assert.equal(status.urban_records, 2);
    assert.equal(status.rural_records, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
