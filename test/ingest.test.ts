import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { ingestEntries, promoteDatabase, removeDatabaseArtifacts, selectLatestResource } from "../src/ingest-lib.js";
import { CatastroStore } from "../src/store.js";

test("selectLatestResource chooses the newest official monthly ZIP", () => {
  const resource = selectLatestResource([
    { id: "july", name: "Datos de padrones urbanos y rurales 07/2026", format: "csv zip", url: "https://example.test/07.zip", last_modified: "2026-07-03T12:44:05.621570" },
    { id: "metadata", name: "metadatos-dnc-1.0.pdf", format: "pdf", url: "https://example.test/meta.pdf", last_modified: "2026-08-10T00:00:00Z" },
    { id: "august", name: "Datos de padrones urbanos y rurales 08/2026", format: "csv zip", url: "https://example.test/08.zip", last_modified: "2026-08-07T18:01:17.687050" },
  ]);

  assert.equal(resource.id, "august");
  assert.equal(resource.snapshot, "2026-08");
});

test("removeDatabaseArtifacts deletes a previous database and every SQLite sidecar", () => {
  const directory = mkdtempSync(join(tmpdir(), "catastro-cleanup-"));
  const databasePath = join(directory, "catastro.sqlite");
  try {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      writeFileSync(`${databasePath}${suffix}`, "stale");
    }
    removeDatabaseArtifacts(databasePath);
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      assert.equal(existsSync(`${databasePath}${suffix}`), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("promoteDatabase atomically replaces the target without preserving old sidecars", () => {
  const directory = mkdtempSync(join(tmpdir(), "catastro-promote-"));
  const buildPath = join(directory, "build.sqlite");
  const targetPath = join(directory, "dist", "catastro.sqlite");
  try {
    writeFileSync(buildPath, "new database");
    mkdirSync(join(directory, "dist"), { recursive: true });
    for (const suffix of ["", "-journal", "-wal", "-shm"]) writeFileSync(`${targetPath}${suffix}`, "old");
    promoteDatabase(buildPath, targetPath);
    assert.equal(readFileSync(targetPath, "utf8"), "new database");
    for (const suffix of ["-journal", "-wal", "-shm", ".next"]) assert.equal(existsSync(`${targetPath}${suffix}`), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ingestEntries creates a queryable official snapshot database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "catastro-ingest-"));
  const databasePath = join(directory, "catastro.sqlite");
  spawnSync(process.execPath, ["-e", `
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1]);
    db.exec("CREATE TABLE stale (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO stale(value) VALUES ('committed')");
    db.exec("BEGIN IMMEDIATE; UPDATE stale SET value = 'uncommitted'");
    process.kill(process.pid, "SIGKILL");
  `, databasePath], { cwd: process.cwd() });
  assert.equal(existsSync(`${databasePath}-journal`), true);
  const entries = [
    { path: "DatosAbiertosDNC(2026-08)/Departamentos.csv", stream: Readable.from([`"A","CANELONES"\n"V","MONTEVIDEO"\n`]) },
    { path: "DatosAbiertosDNC(2026-08)/Localidades.csv", stream: Readable.from([`"A","AA","CANELONES"\n`]) },
    { path: "DatosAbiertosDNC(2026-08)/Padrones Urbanos.csv", stream: Readable.from([`"CO","A","AA",1,"","",0,1473,438,435014,1805540,2240554,2240554,/  /,/  /\n`]) },
    { path: "DatosAbiertosDNC(2026-08)/Padrones Rurales.csv", stream: Readable.from([`"V",539,17,37545,1016619,1016619\n`]) },
  ];

  try {
    const manifest = await ingestEntries({
      databasePath,
      snapshot: "2026-08",
      resourceId: "august",
      sourceUrl: "https://example.test/08.zip",
      publishedAt: "2026-08-07T18:01:17.687050",
      entries,
    });
    assert.equal(manifest.urban_records, 1);
    assert.equal(manifest.rural_records, 1);
    assert.equal(existsSync(`${databasePath}-journal`), false);

    const store = new CatastroStore(databasePath);
    try {
      const urban = store.lookup({ department: "Canelones", padron: "1", locality: "Canelones" });
      const rural = store.lookup({ department: "Montevideo", padron: "539", section: 17 });
      assert.equal(urban.matches[0].cadastral_total_value_uyu, 2240554);
      assert.equal(rural.matches[0].area_land_m2, 37545);
    } finally {
      store.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
