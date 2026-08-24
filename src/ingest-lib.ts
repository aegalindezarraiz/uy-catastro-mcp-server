import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import { parseRuralRow, parseUrbanRow } from "./domain.js";
import { createIndexes, createSchema } from "./store.js";

export type CatalogResource = {
  id: string;
  name: string;
  format: string;
  url: string;
  last_modified?: string | null;
};

const SQLITE_SUFFIXES = ["", "-journal", "-wal", "-shm"] as const;

export function removeDatabaseArtifacts(databasePath: string): void {
  for (const suffix of SQLITE_SUFFIXES) rmSync(`${databasePath}${suffix}`, { force: true });
}

export function promoteDatabase(buildPath: string, targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const stagedPath = `${targetPath}.next`;
  rmSync(stagedPath, { force: true });
  copyFileSync(buildPath, stagedPath);
  removeDatabaseArtifacts(targetPath);
  renameSync(stagedPath, targetPath);
}

export function selectLatestResource(resources: CatalogResource[]) {
  const candidates = resources.flatMap((resource) => {
    if (!/zip/i.test(resource.format) || !/\.zip(?:$|\?)/i.test(resource.url)) return [];
    const match = resource.name.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/);
    if (!match) return [];
    const month = match[1].padStart(2, "0");
    const year = match[2];
    return [{ ...resource, snapshot: `${year}-${month}` }];
  });
  candidates.sort((a, b) => b.snapshot.localeCompare(a.snapshot));
  if (!candidates[0]) throw new Error("No official monthly DNC ZIP resource was found");
  return candidates[0];
}

function makeInsert(db: Database.Database) {
  return db.prepare(`INSERT INTO records (
    regime, department_code, locality_code, padron, block, floor, unit, section,
    area_land_m2, area_built_m2, cadastral_land_value_uyu, cadastral_improvements_value_uyu,
    cadastral_total_value_uyu, taxable_value_uyu, last_declaration_date, declaration_effective_date
  ) VALUES (@regime, @department_code, @locality_code, @padron, @block, @floor,
    @unit, @section, @area_land_m2, @area_built_m2, @cadastral_land_value_uyu,
    @cadastral_improvements_value_uyu, @cadastral_total_value_uyu, @taxable_value_uyu,
    @last_declaration_date, @declaration_effective_date)`);
}

async function* rows(stream: Readable): AsyncGenerator<string[]> {
  const parser = stream
    .pipe(iconv.decodeStream("latin1"))
    .pipe(parse({ bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, trim: true }));
  for await (const row of parser) yield row as string[];
}

export async function ingestEntries(input: {
  databasePath: string;
  snapshot: string;
  resourceId: string;
  sourceUrl: string;
  publishedAt: string;
  entries: Iterable<{ path: string; stream: Readable }> | AsyncIterable<{ path: string; stream: Readable }>;
}) {
  removeDatabaseArtifacts(input.databasePath);
  const db = new Database(input.databasePath);
  db.pragma("journal_mode = MEMORY");
  db.pragma("synchronous = OFF");
  db.pragma("temp_store = MEMORY");
  createSchema(db);

  const departments = new Map<string, string>();
  const localities = new Map<string, string>();
  const insert = makeInsert(db);
  let urbanRecords = 0;
  let ruralRecords = 0;

  db.exec("BEGIN");
  try {
    for await (const entry of input.entries) {
      const filename = entry.path.split("/").pop() ?? entry.path;
      if (filename === "Departamentos.csv") {
        for await (const row of rows(entry.stream)) {
          const code = String(row[0]).trim().toUpperCase();
          const name = String(row[1]).trim().toUpperCase();
          departments.set(code, name);
          db.prepare("INSERT INTO departments (code, name) VALUES (?, ?)").run(code, name);
        }
      } else if (filename === "Localidades.csv") {
        for await (const row of rows(entry.stream)) {
          const departmentCode = String(row[0]).trim().toUpperCase();
          const localityCode = String(row[1]).trim().toUpperCase();
          const name = String(row[2]).trim().toUpperCase();
          localities.set(`${departmentCode}:${localityCode}`, name);
          db.prepare("INSERT INTO localities (department_code, code, name) VALUES (?, ?, ?)").run(departmentCode, localityCode, name);
        }
      } else if (filename === "Padrones Urbanos.csv") {
        if (departments.size === 0 || localities.size === 0) throw new Error("Lookup tables must precede urban records");
        for await (const row of rows(entry.stream)) {
          insert.run(parseUrbanRow(row, departments, localities, input.snapshot, input.sourceUrl));
          urbanRecords += 1;
        }
      } else if (filename === "Padrones Rurales.csv") {
        if (departments.size === 0) throw new Error("Department lookup table must precede rural records");
        for await (const row of rows(entry.stream)) {
          insert.run(parseRuralRow(row, departments, input.snapshot, input.sourceUrl));
          ruralRecords += 1;
        }
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }

  if (urbanRecords === 0 || ruralRecords === 0) {
    db.close();
    throw new Error(`Incomplete DNC archive: urban=${urbanRecords}, rural=${ruralRecords}`);
  }
  createIndexes(db);
  const ingestedAt = new Date().toISOString();
  db.prepare(`INSERT INTO dataset_manifest
    (snapshot, published_at, resource_id, source_url, urban_records, rural_records, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(input.snapshot, input.publishedAt, input.resourceId, input.sourceUrl, urbanRecords, ruralRecords, ingestedAt);
  db.pragma("optimize");
  db.close();
  const sidecars = SQLITE_SUFFIXES.slice(1).map((suffix) => `${input.databasePath}${suffix}`).filter(existsSync);
  if (sidecars.length > 0) {
    throw new Error(`SQLite build left unsafe sidecar files: ${sidecars.join(", ")}`);
  }
  return {
    snapshot: input.snapshot,
    published_at: input.publishedAt,
    resource_id: input.resourceId,
    source_url: input.sourceUrl,
    urban_records: urbanRecords,
    rural_records: ruralRecords,
    ingested_at: ingestedAt,
  };
}
