import type { CatastroRecord, PadronQuery } from "./domain.js";
import { estimateAvm, type AvmComparable, type AvmOptions, type AvmProperty } from "./avm.js";

const CEDULA_ISSUER_URL = "https://apls2.catastro.gub.uy:8443/integralevol3produccion/servlet/gub.catastro.integralevol3produccion.apwebimpresioncedulasgeocatastro?";
const VISOR_DNC_ARCGIS_URL = "http://gis.catastro.gub.uy/arcgis/rest/services/v2022/Mapa_Base_DNCv_11_2022Prod/MapServer";
const MTOP_PLAN_ARCHIVE_URL = "https://planos.mtop.gub.uy/pesgpm/servlet/hconsulta";
const VISOR_DEPARTMENT_NUMBER: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10,
  K: 11, L: 12, M: 13, N: 14, O: 15, P: 16, Q: 17, R: 18, V: 19,
};
const VISOR_PAIRED_LOCALITY: Record<number, number> = { 405: 406, 400: 401, 397: 398, 390: 391 };

export function buildCedulaCatastralIssueUrl(record: CatastroRecord): string {
  if (record.regime === "RU") {
    if (record.department_code === "V") {
      return `${CEDULA_ISSUER_URL}C,V,AA,${record.padron},,,`;
    }
    return `${CEDULA_ISSUER_URL}R,${record.department_code},,${record.padron},,,`;
  }
  if (record.regime === "PH") {
    return `${CEDULA_ISSUER_URL}H,${record.department_code},${record.locality_code ?? ""},${record.padron},${record.block ?? ""},${record.floor ?? ""},${record.unit ?? ""}`;
  }
  if (record.regime === "UH") {
    return `${CEDULA_ISSUER_URL}U,${record.department_code},${record.locality_code ?? ""},${record.padron},${record.block ?? ""},,${record.unit ?? ""}`;
  }
  return `${CEDULA_ISSUER_URL}C,${record.department_code},${record.locality_code},${record.padron},,,`;
}

export async function issueCedulaCatastral(record: CatastroRecord, fetchImpl: typeof fetch = fetch) {
  const issuanceUrl = buildCedulaCatastralIssueUrl(record);
  const response = await fetchImpl(issuanceUrl, { redirect: "manual" });
  const location = response.headers.get("location");
  if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
    throw new Error(`DNC cedula issuer returned HTTP ${response.status} without a PDF redirect`);
  }
  const pdfUrl = new URL(location, issuanceUrl);
  if (pdfUrl.origin !== new URL(CEDULA_ISSUER_URL).origin || !pdfUrl.pathname.endsWith(".pdf")) {
    throw new Error("DNC cedula issuer returned an unsafe PDF location");
  }
  return {
    ok: true as const,
    document_type: "cedula_catastral_comun" as const,
    issuance_url: issuanceUrl,
    pdf_url: pdfUrl.toString(),
    source: "Direccion Nacional de Catastro",
  };
}

type ArcGisFeature = { attributes: Record<string, string | number | null> };

async function fetchArcGisFeatures(layer: number, where: string, fetchImpl: typeof fetch): Promise<ArcGisFeature[]> {
  const url = new URL(`${VISOR_DNC_ARCGIS_URL}/${layer}/query`);
  url.search = new URLSearchParams({ where, outFields: "*", returnGeometry: "false", f: "json" }).toString();
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Visor DNC layer ${layer} returned HTTP ${response.status}`);
  const payload = await response.json() as { features?: ArcGisFeature[]; error?: { message?: string } };
  if (payload.error) throw new Error(`Visor DNC layer ${layer}: ${payload.error.message ?? "query failed"}`);
  return payload.features ?? [];
}

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export async function fetchRegisteredPlans(record: CatastroRecord, fetchImpl: typeof fetch = fetch) {
  const departmentNumber = VISOR_DEPARTMENT_NUMBER[record.department_code];
  if (!departmentNumber) throw new Error(`Unsupported DNC department code: ${record.department_code}`);
  let planRows: ArcGisFeature[];
  if (record.regime === "RU") {
    planRows = await fetchArcGisFeatures(
      7,
      `TIPOPLANO = 'R' AND NUMDEPTO = ${departmentNumber} AND PLAPADRON = ${record.padron}`,
      fetchImpl,
    );
  } else {
    const localityRows = await fetchArcGisFeatures(
      10,
      `CODDEPTO = '${record.department_code}' AND CODLOCCAT = '${record.locality_code ?? ""}'`,
      fetchImpl,
    );
    const localityNumbers = [...new Set(localityRows.flatMap((feature) => {
      const number = Number(feature.attributes.NUMLOCCAT);
      if (!Number.isFinite(number)) return [];
      return VISOR_PAIRED_LOCALITY[number] ? [number, VISOR_PAIRED_LOCALITY[number]] : [number];
    }))];
    planRows = await fetchArcGisFeatures(
      7,
      `NUMLOCCAT IN (${localityNumbers.join(",")}) AND TIPOPLANO = 'U' AND PLAPADRON = ${record.padron}`,
      fetchImpl,
    );
  }
  const registryNumbers = [...new Set(planRows.map((feature) => Number(feature.attributes.PLAREGPLA)).filter(Number.isFinite))];
  const surveyorRows = registryNumbers.length > 0
    ? await fetchArcGisFeatures(6, `NUMDEPTO = ${departmentNumber} AND NUMREGPLANO IN (${registryNumbers.join(",")})`, fetchImpl)
    : [];
  const surveyors = new Map(surveyorRows.map((feature) => [
    `${feature.attributes.NUMREGPLANO}:${feature.attributes.FECHAPLANO}`,
    String(feature.attributes.NOMAGRIM ?? "").replaceAll("¥", "Ñ").trim() || "SIN DATOS",
  ]));
  const plans = planRows.map((feature) => {
    const attributes = feature.attributes;
    const timestamp = Number(attributes.PLAFCHREG);
    const registryNumber = Number(attributes.PLAREGPLA);
    return {
      registry_number: registryNumber,
      registration_date: utcDate(timestamp),
      surveyor: surveyors.get(`${registryNumber}:${timestamp}`) ?? "SIN DATOS",
      plan_type: String(attributes.TIPOPLANO ?? "U") === "R" ? "rural" : "urban",
      department: String(attributes.NOMDEPTO ?? record.department),
      locality: attributes.NOMLOCCAT ? String(attributes.NOMLOCCAT) : null,
      padron: String(attributes.PLAPADRON ?? record.padron),
    };
  });
  return {
    ok: true as const,
    plans,
    source_url: "https://visor.catastro.gub.uy/visordnc/",
    archive_url: MTOP_PLAN_ARCHIVE_URL,
    provider_note: "El acceso a las imágenes de planos es provisto y mantenido por el Archivo Gráfico del MTOP.",
  };
}

export type LookupResult = {
  found: boolean;
  ambiguous: boolean;
  query: PadronQuery;
  matches: Array<Partial<CatastroRecord> & { department: string; padron: string }>;
};

export async function makeCedulaOutput(result: LookupResult, fetchImpl: typeof fetch = fetch) {
  if (result.matches.length !== 1) {
    const reason = result.matches.length === 0 ? "not_found" as const : "ambiguous" as const;
    const text = reason === "not_found"
      ? `No se puede emitir la cédula: no se encontró el padrón ${result.query.padron}.`
      : `No se puede emitir la cédula: la referencia devuelve ${result.matches.length} candidatos. Indique localidad, sección, block, piso o unidad.`;
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { ok: false as const, reason, lookup: result },
    };
  }
  const record = result.matches[0] as CatastroRecord;
  const issued = await issueCedulaCatastral(record, fetchImpl);
  return {
    content: [
      {
        type: "text" as const,
        text: `Cédula catastral común emitida por la DNC para el padrón ${record.padron}, ${record.department}. Es el documento oficial con valor legal; no es una cédula catastral informada.`,
      },
      {
        type: "resource_link" as const,
        uri: issued.pdf_url,
        name: `cedula-catastral-${record.department_code}-${record.padron}.pdf`,
        title: `Cédula catastral — padrón ${record.padron}`,
        description: "PDF emitido por la Dirección Nacional de Catastro",
        mimeType: "application/pdf",
      },
    ],
    structuredContent: { ...issued, record, lookup: result },
  };
}

export async function makeRegisteredPlansOutput(result: LookupResult, fetchImpl: typeof fetch = fetch) {
  if (result.matches.length !== 1) {
    const reason = result.matches.length === 0 ? "not_found" as const : "ambiguous" as const;
    const text = reason === "not_found"
      ? `No se pueden consultar planos: no se encontró el padrón ${result.query.padron}.`
      : `No se pueden consultar planos: la referencia devuelve ${result.matches.length} candidatos. Indique localidad o sección catastral.`;
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { ok: false as const, reason, lookup: result },
    };
  }
  const record = result.matches[0] as CatastroRecord;
  const registered = await fetchRegisteredPlans(record, fetchImpl);
  const planLines = registered.plans.length === 0
    ? "El Visor DNC no devuelve planos registrados para esta referencia."
    : registered.plans.map((plan, index) =>
      `${index + 1}. Registro ${plan.registry_number}; fecha ${plan.registration_date}; agrimensor: ${plan.surveyor}.`
    ).join("\n");
  return {
    content: [
      {
        type: "text" as const,
        text: `Planos registrados del padrón ${record.padron}, ${record.department}: ${registered.plans.length}.\n${planLines}\nEl acceso a las imágenes depende del Archivo Gráfico del MTOP.`,
      },
      {
        type: "resource_link" as const,
        uri: registered.archive_url,
        name: "archivo-grafico-mtop",
        title: "Archivo Gráfico del MTOP — consulta de planos",
        description: "Servicio oficial de acceso a imágenes de planos registrados",
        mimeType: "text/html",
      },
    ],
    structuredContent: { ...registered, record, lookup: result },
  };
}

export type AvmRequest = {
  valuation_date?: string;
  subject: Omit<AvmProperty, "area_m2"> & { area_m2?: number };
  comparables: AvmComparable[];
  options?: AvmOptions;
};

export function makeAvmOutput(result: LookupResult, request: AvmRequest) {
  if (result.matches.length !== 1) {
    const reason = result.matches.length === 0 ? "not_found" as const : "ambiguous" as const;
    const text = reason === "not_found"
      ? `No se puede ejecutar el AVM: no se encontró el padrón ${result.query.padron}.`
      : `No se puede ejecutar el AVM: la referencia devuelve ${result.matches.length} candidatos. Indique localidad, sección, block, piso o unidad.`;
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { ok: false as const, reason, lookup: result },
    };
  }
  const cadastralRecord = result.matches[0] as CatastroRecord;
  const cadastralArea = request.subject.property_type === "land"
    ? cadastralRecord.area_land_m2
    : cadastralRecord.area_built_m2 ?? cadastralRecord.area_land_m2;
  const areaM2 = request.subject.area_m2 ?? cadastralArea;
  if (!areaM2 || !Number.isFinite(areaM2) || areaM2 <= 0) {
    return {
      content: [{ type: "text" as const, text: "No se puede ejecutar el AVM: falta una superficie válida y Catastro no aporta una utilizable para este inmueble." }],
      structuredContent: { ok: false as const, reason: "missing_subject_area" as const, cadastral_record: cadastralRecord, lookup: result },
    };
  }
  const avm = estimateAvm({ ...request, subject: { ...request.subject, area_m2: areaM2 } });
  const text = avm.ok
    ? `AVM D3 orientativo: USD ${avm.estimated_value_usd.toLocaleString("en-US")} (rango ${avm.range_usd.confidence_level}: USD ${avm.range_usd.low.toLocaleString("en-US")}–${avm.range_usd.high.toLocaleString("en-US")}); confianza ${avm.confidence.grade} (${avm.confidence.score}/100). No es una tasación certificada.`
    : `No se pudo calcular el AVM: quedaron ${avm.comparables.used} testigos válidos y se requieren al menos 3.`;
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { ...avm, cadastral_record: cadastralRecord, area_source: request.subject.area_m2 ? "user" : "dnc_snapshot", lookup: result },
  };
}

function recordLabel(record: Partial<CatastroRecord> & { department: string; padron: string }): string {
  const place = record.locality ? `localidad ${record.locality}` : `sección ${record.section ?? "N/D"}`;
  const unit = record.unit !== null && record.unit !== undefined ? `, unidad ${record.unit}` : "";
  return `Padrón ${record.padron}, ${record.department}, ${record.regime ?? "régimen N/D"}, ${place}${unit}`;
}

export function makeLookupOutput(result: LookupResult) {
  let text: string;
  if (!result.found) {
    text = `No se encontró el padrón ${result.query.padron} en ${result.query.department} dentro del snapshot oficial cargado. Revise departamento, localidad o sección catastral.`;
  } else if (result.ambiguous) {
    text = `Se encontraron ${result.matches.length} candidatos. Indique la localidad para un padrón urbano o la sección catastral para uno rural.\n` +
      result.matches.slice(0, 10).map((record, index) => `${index + 1}. ${recordLabel(record)}`).join("\n");
  } else {
    const record = result.matches[0];
    text = `${recordLabel(record)}. Área del predio: ${record.area_land_m2 ?? "N/D"} m²; área edificada: ${record.area_built_m2 ?? "N/D"} m²; valor catastral total: ${record.cadastral_total_value_uyu ?? "N/D"} UYU; valor para impuestos: ${record.taxable_value_uyu ?? "N/D"} UYU. Snapshot DNC: ${record.snapshot ?? "N/D"}.`;
  }
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: result,
  };
}

export function officialGuide(topic: string) {
  const dataset = { title: "Dataset oficial DNC — Padrones urbanos y rurales", url: "https://catalogodatos.gub.uy/dataset/direccion-nacional-de-catastro-padrones-urbanos-y-rurales" };
  const cedula = { title: "Cédula catastral", url: "https://www.gub.uy/tramites/cedula-catastral" };
  const informed = { title: "Cédula catastral informada", url: "https://www.gub.uy/tramites/cedula-catastral-informada" };
  const bcuHedonic = { title: "BCU — modelos hedónicos de precios de inmuebles", url: "https://www.bcu.gub.uy/Estadisticas-e-Indicadores/Documentos%20de%20Trabajo/11.2013.pdf" };
  const guides: Record<string, { text: string; links: Array<{ title: string; url: string }> }> = {
    general: {
      text: "Este MCP consulta un snapshot de datos abiertos de la DNC. Sirve para verificación preliminar; no sustituye certificados, estudio de títulos, información registral ni control de deudas.",
      links: [dataset, cedula],
    },
    valor_legal: {
      text: "Para acreditar el valor legal corresponde obtener la cédula catastral. El valor catastral del dataset no es una tasación ni un valor de mercado.",
      links: [cedula, informed],
    },
    due_diligence: {
      text: "La debida diligencia inmobiliaria requiere, además de Catastro, identificar correctamente el inmueble y verificar titularidad, tracto, gravámenes, hipotecas, embargos, deudas y documentación notarial en las fuentes competentes.",
      links: [cedula, informed, dataset],
    },
    propiedad_horizontal: {
      text: "En propiedad horizontal deben identificarse localidad, padrón, block, piso y unidad cuando corresponda. El snapshot abierto no sustituye el reglamento de copropiedad ni la documentación registral/notarial.",
      links: [cedula, dataset],
    },
    data_source: {
      text: "La fuente es el conjunto mensual de padrones urbanos y rurales publicado por la Dirección Nacional de Catastro en el Catálogo de Datos Abiertos de Uruguay.",
      links: [dataset],
    },
    avm: {
      text: "El AVM D3 exige testigos verificables de venta u oferta, limpia anomalías y devuelve intervalo, confianza y ajustes. Es una estimación automatizada orientativa: no es una tasación, certificado ni garantía del precio de cierre.",
      links: [dataset, bcuHedonic],
    },
  };
  return guides[topic] ?? guides.general;
}
