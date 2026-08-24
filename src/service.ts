import type { CatastroRecord, PadronQuery } from "./domain.js";

type LookupResult = {
  found: boolean;
  ambiguous: boolean;
  query: PadronQuery;
  matches: Array<Partial<CatastroRecord> & { department: string; padron: string }>;
};

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
  };
  return guides[topic] ?? guides.general;
}
