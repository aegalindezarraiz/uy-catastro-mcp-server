import Database from "better-sqlite3";
import { normalizeDepartmentName, normalizePadron, type CatastroRecord, type PadronQuery } from "./domain.js";

export function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE dataset_manifest (
      snapshot TEXT NOT NULL,
      published_at TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      urban_records INTEGER NOT NULL,
      rural_records INTEGER NOT NULL,
      ingested_at TEXT NOT NULL
    );
    CREATE TABLE departments (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    ) WITHOUT ROWID;
    CREATE TABLE localities (
      department_code TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (department_code, code)
    ) WITHOUT ROWID;
    CREATE TABLE records (
      id INTEGER PRIMARY KEY,
      regime TEXT NOT NULL,
      department_code TEXT NOT NULL,
      locality_code TEXT,
      padron INTEGER NOT NULL,
      block TEXT,
      floor TEXT,
      unit INTEGER,
      section INTEGER,
      area_land_m2 INTEGER,
      area_built_m2 INTEGER,
      cadastral_land_value_uyu INTEGER,
      cadastral_improvements_value_uyu INTEGER,
      cadastral_total_value_uyu INTEGER,
      taxable_value_uyu INTEGER,
      last_declaration_date TEXT,
      declaration_effective_date TEXT
    );
  `);
}

export function createIndexes(db: Database.Database): void {
  db.exec(`
    CREATE INDEX idx_records_department_code_padron ON records (department_code, padron);
  `);
}

export class CatastroStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    this.db = new Database(databasePath, { readonly: true });
  }

  lookup(query: PadronQuery) {
    const normalizedDepartment = normalizeDepartmentName(query.department);
    const normalizedPadron = normalizePadron(query.padron);
    const departmentCode = this.db.prepare(
      "SELECT code FROM departments WHERE code = ? OR name = ? LIMIT 1",
    ).pluck().get(normalizedDepartment, normalizedDepartment) as string | undefined;
    if (!departmentCode) {
      return {
        found: false,
        ambiguous: false,
        matches: [] as CatastroRecord[],
        query: { ...query, department: normalizedDepartment, padron: normalizedPadron },
      };
    }
    const conditions = ["r.department_code = @departmentCode", "r.padron = @padron"];
    const parameters: Record<string, string | number> = {
      departmentCode,
      padron: normalizedPadron,
    };

    if (query.regime) {
      conditions.push("r.regime = @regime");
      parameters.regime = String(query.regime).trim().toUpperCase();
    }
    if (query.locality) {
      const normalizedLocality = normalizeDepartmentName(query.locality);
      conditions.push("(l.name = @locality OR r.locality_code = @locality)");
      parameters.locality = normalizedLocality;
    }
    if (query.section !== undefined) {
      conditions.push("r.section = @section");
      parameters.section = query.section;
    }
    if (query.block !== undefined) {
      conditions.push("r.block = @block");
      parameters.block = query.block;
    }
    if (query.floor !== undefined) {
      conditions.push("r.floor = @floor");
      parameters.floor = query.floor;
    }
    if (query.unit !== undefined) {
      conditions.push("r.unit = @unit");
      parameters.unit = query.unit;
    }

    const rows = this.db.prepare(
      `SELECT r.regime, r.department_code, d.name AS department, r.locality_code, l.name AS locality,
        CAST(r.padron AS TEXT) AS padron, r.block, r.floor, r.unit, r.section, r.area_land_m2,
        r.area_built_m2, r.cadastral_land_value_uyu, r.cadastral_improvements_value_uyu,
        r.cadastral_total_value_uyu, r.taxable_value_uyu, r.last_declaration_date,
        r.declaration_effective_date, m.snapshot, m.source_url
       FROM records r
       JOIN departments d ON d.code = r.department_code
       LEFT JOIN localities l ON l.department_code = r.department_code AND l.code = r.locality_code
       CROSS JOIN (SELECT snapshot, source_url FROM dataset_manifest ORDER BY rowid DESC LIMIT 1) m
       WHERE ${conditions.join(" AND ")} ORDER BY r.regime, r.locality_code, r.block, r.floor, r.unit LIMIT 100`,
    ).all(parameters) as CatastroRecord[];

    return {
      found: rows.length > 0,
      ambiguous: rows.length > 1,
      matches: rows,
      query: { ...query, department: normalizedDepartment, padron: normalizedPadron },
    };
  }

  getStatus() {
    const manifest = this.db.prepare(
      `SELECT snapshot, published_at, resource_id, source_url, urban_records, rural_records, ingested_at
       FROM dataset_manifest ORDER BY rowid DESC LIMIT 1`,
    ).get() as {
      snapshot: string; published_at: string; resource_id: string; source_url: string;
      urban_records: number; rural_records: number; ingested_at: string;
    } | undefined;
    if (!manifest) throw new Error("Dataset manifest is missing");
    return {
      ok: true,
      mode: "official_snapshot",
      ...manifest,
      records_loaded: manifest.urban_records + manifest.rural_records,
    };
  }

  close(): void {
    this.db.close();
  }
}
