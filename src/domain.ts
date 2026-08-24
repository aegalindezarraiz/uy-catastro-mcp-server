export type CatastroRecord = {
  regime: "CO" | "PH" | "UH" | "RU" | string;
  department_code: string;
  department: string;
  locality_code: string | null;
  locality: string | null;
  padron: string;
  block: string | null;
  floor: string | null;
  unit: number | null;
  section: number | null;
  area_land_m2: number | null;
  area_built_m2: number | null;
  cadastral_land_value_uyu: number | null;
  cadastral_improvements_value_uyu: number | null;
  cadastral_total_value_uyu: number | null;
  taxable_value_uyu: number | null;
  last_declaration_date: string | null;
  declaration_effective_date: string | null;
  snapshot: string;
  source_url: string;
};

export type PadronQuery = {
  department: string;
  padron: string;
  regime?: string;
  locality?: string;
  section?: number;
  block?: string;
  floor?: string;
  unit?: number;
};

function nullableText(value: string | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function nullableNumber(value: string | undefined): number | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableDate(value: string | undefined): string | null {
  const normalized = String(value ?? "").trim();
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(normalized)) return null;
  const [day, month, year] = normalized.split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function normalizeDepartmentName(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function parseUrbanRow(
  row: string[],
  departments: Map<string, string>,
  localities: Map<string, string>,
  snapshot: string,
  sourceUrl: string,
): CatastroRecord {
  const departmentCode = String(row[1] ?? "").trim().toUpperCase();
  const localityCode = String(row[2] ?? "").trim().toUpperCase();
  return {
    regime: String(row[0] ?? "").trim().toUpperCase(),
    department_code: departmentCode,
    department: departments.get(departmentCode) ?? departmentCode,
    locality_code: localityCode || null,
    locality: localities.get(`${departmentCode}:${localityCode}`) ?? localityCode ?? null,
    padron: normalizePadron(row[3]),
    block: nullableText(row[4]),
    floor: nullableText(row[5]),
    unit: nullableNumber(row[6]),
    section: null,
    area_land_m2: nullableNumber(row[7]),
    area_built_m2: nullableNumber(row[8]),
    cadastral_land_value_uyu: nullableNumber(row[9]),
    cadastral_improvements_value_uyu: nullableNumber(row[10]),
    cadastral_total_value_uyu: nullableNumber(row[11]),
    taxable_value_uyu: nullableNumber(row[12]),
    last_declaration_date: nullableDate(row[13]),
    declaration_effective_date: nullableDate(row[14]),
    snapshot,
    source_url: sourceUrl,
  };
}

export function parseRuralRow(
  row: string[],
  departments: Map<string, string>,
  snapshot: string,
  sourceUrl: string,
): CatastroRecord {
  const departmentCode = String(row[0] ?? "").trim().toUpperCase();
  return {
    regime: "RU",
    department_code: departmentCode,
    department: departments.get(departmentCode) ?? departmentCode,
    locality_code: null,
    locality: null,
    padron: normalizePadron(row[1]),
    block: null,
    floor: null,
    unit: null,
    section: nullableNumber(row[2]),
    area_land_m2: nullableNumber(row[3]),
    area_built_m2: null,
    cadastral_land_value_uyu: null,
    cadastral_improvements_value_uyu: null,
    cadastral_total_value_uyu: nullableNumber(row[4]),
    taxable_value_uyu: nullableNumber(row[5]),
    last_declaration_date: null,
    declaration_effective_date: null,
    snapshot,
    source_url: sourceUrl,
  };
}

export function normalizePadron(value: unknown): string {
  const normalized = String(value ?? "").trim();
  return normalized.replace(/^0+(?=\d)/, "");
}

export function buildDueDiligenceBrief(input: { query: PadronQuery; matches: CatastroRecord[] }) {
  if (input.matches.length === 0) {
    return {
      ok: false as const,
      reason: "not_found" as const,
      text: `No se encontró el padrón ${input.query.padron} en ${input.query.department} dentro del snapshot oficial.`,
    };
  }
  if (input.matches.length > 1) {
    return {
      ok: false as const,
      reason: "ambiguous" as const,
      text: `La referencia devuelve ${input.matches.length} candidatos. Indique localidad para urbano o sección catastral para rural.`,
    };
  }

  const record = input.matches[0];
  const location = record.locality ? `Localidad: ${record.locality}.` : `Sección catastral: ${record.section ?? "N/D"}.`;
  const text = [
    `BRIEF CATASTRAL PRELIMINAR — Padrón ${record.padron}, ${record.department}.`,
    `Régimen: ${record.regime}. ${location}`,
    `Área del predio: ${record.area_land_m2 ?? "N/D"} m². Área edificada: ${record.area_built_m2 ?? "N/D"} m².`,
    `Valor catastral total: ${record.cadastral_total_value_uyu ?? "N/D"} UYU. Valor para impuestos: ${record.taxable_value_uyu ?? "N/D"} UYU.`,
    `Fuente: snapshot DNC ${record.snapshot}.`,
    "Alcance: consulta preliminar de datos abiertos; no certifica dirección, titularidad, vigencia jurídica, gravámenes, deudas ni valor de mercado. Para valor legal corresponde obtener la cédula catastral y completar el estudio registral/notarial.",
  ].join("\n");
  return { ok: true as const, reason: null, text, record };
}
