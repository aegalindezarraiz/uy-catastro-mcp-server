/**
 * Servidor MCP de Catastro Uruguay
 * @author Angel Eduardo Galindez
 * @version 1.0.0
 * @description Servidor MCP para consulta de datos catastrales públicos de Uruguay
 */
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

type PadronRecord = {
  department: string; padron: string; section: string | null; locality: string | null;
  address: string | null; area_m2: number | null; area_ha: number | null;
  value_real: number | null; value_fiscal: number | null; regime_type: string | null;
  vigente: boolean; source: string; legal_note: string;
};

type PadronRef = { department: string; padron: string; };

const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

const PADRONES: PadronRecord[] = [
  { department: "MONTEVIDEO", padron: "40567", section: "03", locality: "Montevideo", address: "Av. 18 de Julio 1234", area_m2: 412.5, area_ha: 0.04125, value_real: 9850000, value_fiscal: 4200000, regime_type: "Propiedad Horizontal", vigente: true, source: "Catastro Uruguay MCP", legal_note: "Datos orientativos. Para valor legal consulte DNC." },
  { department: "CANELONES", padron: "98211", section: "11", locality: "Ciudad de la Costa", address: "Rambla Costanera s/n", area_m2: 680, area_ha: 0.068, value_real: 6200000, value_fiscal: 2800000, regime_type: "Propiedad Comun", vigente: true, source: "Catastro Uruguay MCP", legal_note: "Datos orientativos. Para valor legal consulte DNC." },
  { department: "MALDONADO", padron: "77120", section: "07", locality: "Punta del Este", address: "Parada 8, Playa Mansa", area_m2: 1200, area_ha: 0.12, value_real: 21500000, value_fiscal: 9800000, regime_type: "Propiedad Comun", vigente: true, source: "Catastro Uruguay MCP", legal_note: "Datos orientativos. Para valor legal consulte DNC." },
  { department: "COLONIA", padron: "55001", section: "02", locality: "Colonia del Sacramento", address: "Barrio Historico", area_m2: 310, area_ha: 0.031, value_real: 4400000, value_fiscal: 1900000, regime_type: "Propiedad Comun", vigente: true, source: "Catastro Uruguay MCP", legal_note: "Datos orientativos. Para valor legal consulte DNC." },
];

const DATASET_STATUS = { ok: true, mode: process.env.CATASTRO_MODE ?? "demo", source: "Catastro Uruguay MCP", last_update: "2026-03-10", records_loaded: PADRONES.length };

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();
}

function findPadron(ref: PadronRef): PadronRecord | undefined {
  return PADRONES.find(item => normalizeText(item.department) === normalizeText(ref.department) && String(item.padron).trim() === String(ref.padron).trim());
}

function summarizePadron(r: PadronRecord): string {
  return "Padron " + r.padron + " (" + r.department + ")" +
    (r.locality ? ", localidad: " + r.locality : "") +
    (r.address ? ", direccion: " + r.address : "") +
    ", vigente: " + (r.vigente ? "si" : "no") +
    (r.area_m2 ? ", area: " + r.area_m2 + "m2" : "") +
    (r.value_real ? ", valor real: $" + r.value_real : "") +
    (r.value_fiscal ? ", valor fiscal: $" + r.value_fiscal : "") +
    (r.regime_type ? ", regimen: " + r.regime_type : "");
}

function createCatastroServer() {
  const server = new McpServer({ name: "uy-catastro-mcp", version: "1.0.0" });

  server.registerTool("uy_catastro_lookup_padron", {
    title: "Lookup de padron",
    description: "Busca un padron por departamento y numero. Devuelve datos catastrales orientativos.",
    inputSchema: {
      department: z.string().describe("Departamento (ej: MONTEVIDEO, CANELONES)"),
      padron: z.string().describe("Numero de padron (ej: 40567)"),
    },
  }, async (input) => {
    const record = findPadron({ department: String(input.department), padron: String(input.padron) });
    if (!record) return { content: [{ type: "text" as const, text: "No encontre el padron " + input.padron + " en " + input.department + ". Verifique el numero y el departamento." }], structuredContent: { found: false } };
    return { content: [{ type: "text" as const, text: summarizePadron(record) }], structuredContent: { found: true, padron: record } };
  });

  server.registerTool("uy_catastro_compare_padrones", {
    title: "Comparar padrones",
    description: "Compara dos o mas padrones.",
    inputSchema: {
      padrones: z.array(z.object({ department: z.string(), padron: z.string() })).describe("Lista de padrones a comparar"),
    },
  }, async (input) => {
    const refs = Array.isArray(input.padrones) ? (input.padrones as PadronRef[]) : [];
    const found: PadronRecord[] = []; const missing: PadronRef[] = [];
    for (const ref of refs) { const r = findPadron(ref); if (r) found.push(r); else missing.push(ref); }
    if (found.length === 0) return { content: [{ type: "text" as const, text: "No se encontro ninguno." }], structuredContent: { compared: [], missing } };
    return { content: [{ type: "text" as const, text: "Compare " + found.length + " padron(es)." }], structuredContent: { compared: found, missing } };
  });

  server.registerTool("uy_catastro_get_dataset_status", {
    title: "Estado del dataset",
    description: "Devuelve el estado del dataset.",
    inputSchema: {},
  }, async () => {
    return { content: [{ type: "text" as const, text: "Dataset " + DATASET_STATUS.mode + ": " + DATASET_STATUS.records_loaded + " registros." }], structuredContent: DATASET_STATUS };
  });

  server.registerTool("uy_catastro_get_official_guide", {
    title: "Guia oficial",
    description: "Devuelve guia orientativa sobre datos catastrales.",
    inputSchema: {
      topic: z.string().optional().describe("general | valor_legal | due_diligence | propiedad_horizontal"),
    },
  }, async (input) => {
    const topic = String(input.topic || "general");
    const guides: Record<string, string> = {
      general: "Use esta app para orientacion preliminar. Para certificacion con valor legal, tramite ante la DNC.",
      valor_legal: "El valor fiscal es establecido por la DNC. Para tramites oficiales, solicite certificado catastral.",
      due_diligence: "Verificar vigencia del padron, deudas, gravamenes e hipotecas ante el Registro de la Propiedad.",
      propiedad_horizontal: "Verificar reglamento de copropiedad, padron matriz y unidades en DNC.",
    };
    return { content: [{ type: "text" as const, text: guides[topic] || guides["general"] }], structuredContent: { topic, guide: guides[topic] || guides["general"] } };
  });

  server.registerTool("uy_catastro_build_due_diligence_brief", {
    title: "Due diligence brief",
    description: "Genera un informe de due diligence para un padron.",
    inputSchema: {
      department: z.string().describe("Departamento"),
      padron: z.string().describe("Numero de padron"),
      include_valuation: z.boolean().optional().describe("Incluir valuacion"),
    },
  }, async (input) => {
    const record = findPadron({ department: String(input.department), padron: String(input.padron) });
    if (!record) return { content: [{ type: "text" as const, text: "Padron no encontrado: " + input.padron + " en " + input.department }], structuredContent: { found: false } };
    const brief = "DUE DILIGENCE - " + record.padron + " (" + record.department + ")\n" +
      "Direccion: " + (record.address || "N/D") + "\n" +
      "Area: " + (record.area_m2 || "N/D") + "m2\n" +
      "Vigente: " + (record.vigente ? "Si" : "No") + "\n" +
      (input.include_valuation ? "Valor Real: $" + record.value_real + "\nValor Fiscal: $" + record.value_fiscal + "\n" : "") +
      "Regimen: " + (record.regime_type || "N/D") + "\n" +
      "NOTA: " + record.legal_note;
    return { content: [{ type: "text" as const, text: brief }], structuredContent: { found: true, padron: record, brief } };
  });

  return server;
}

const app = createServer(async (req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "uy-catastro-mcp", version: "1.0.0" }));
    return;
  }
  if (req.url?.startsWith(MCP_PATH)) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    await transport.handleRequest(req, res);
    const server = createCatastroServer();
    await server.connect(transport);
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

app.listen(PORT, () => {
  console.log("Uy Catastro MCP server listening on http://localhost:" + PORT + MCP_PATH);
});
