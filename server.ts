import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

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
  { department: "MONTEVIDEO", padron: "40567", section: "03", locality: "Montevideo", address: "Av. 18 de Julio 1234", area_m2: 412.5, area_ha: 0.04125, value_real: 9850000, value_fiscal: 7312000, regime_type: "Comun", vigente: true, source: "demo-public", legal_note: "Informacion de referencia; no sustituye certificacion oficial de Catastro." },
  { department: "CANELONES", padron: "98211", section: "11", locality: "Ciudad de la Costa", address: "Rambla Costanera s/n", area_m2: 680, area_ha: 0.068, value_real: 6200000, value_fiscal: 4580000, regime_type: "Comun", vigente: true, source: "demo-public", legal_note: "Informacion de referencia; no sustituye certificacion oficial de Catastro." },
  { department: "MALDONADO", padron: "77120", section: "07", locality: "Punta del Este", address: "Parada 8, Playa Mansa", area_m2: 1200, area_ha: 0.12, value_real: 21500000, value_fiscal: 17120000, regime_type: "Propiedad horizontal", vigente: true, source: "demo-public", legal_note: "Informacion de referencia; no sustituye certificacion oficial de Catastro." },
  { department: "COLONIA", padron: "55001", section: "02", locality: "Colonia del Sacramento", address: "Barrio Historico", area_m2: 310, area_ha: 0.031, value_real: 4400000, value_fiscal: 3250000, regime_type: "Comun", vigente: false, source: "demo-public", legal_note: "Informacion de referencia; no sustituye certificacion oficial de Catastro." }
];

const DATASET_STATUS = { ok: true, mode: process.env.CATASTRO_MODE ?? "demo", source: "Catastro Uruguay MCP", last_update: "2026-03-10", records_loaded: PADRONES.length };

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();
}

function findPadron(ref: PadronRef): PadronRecord | undefined {
  return PADRONES.find(item => normalizeText(item.department) === normalizeText(ref.department) && String(item.padron).trim() === String(ref.padron).trim());
}

function summarizePadron(r: PadronRecord): string {
  return ["Padron " + r.padron + " (" + r.department + ")", r.locality ? "localidad: " + r.locality : null, r.address ? "direccion: " + r.address : null, "vigente: " + (r.vigente ? "si" : "no"), r.area_m2 != null ? "area: " + r.area_m2 + " m2" : null, r.value_real != null ? "valor real: UYU " + r.value_real : null, r.regime_type ? "regimen: " + r.regime_type : null].filter(Boolean).join(", ");
}

function toolError(text: string, sc: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], structuredContent: sc, isError: true };
}

function createCatastroServer() {
  const server = new McpServer({ name: "uy-catastro-mcp", version: "1.0.0" });

  server.registerTool("uy_catastro_lookup_padron", { title: "Lookup de padron", description: "Busca un padron por departamento y numero. Devuelve datos catastrales orientativos.", inputSchema: { type: "object", properties: { department: { type: "string" }, padron: { type: "string" } }, required: ["department", "padron"], additionalProperties: false }, securitySchemes: [{ type: "noauth" }] }, async ({ input }) => {
    const record = findPadron({ department: String(input.department), padron: String(input.padron) });
    if (!record) return toolError("No encontre el padron " + input.padron + " en " + input.department, { found: false });
    return { content: [{ type: "text", text: summarizePadron(record) }], structuredContent: { found: true, padron: record } };
  });

  server.registerTool("uy_catastro_compare_padrones", { title: "Comparar padrones", description: "Compara dos o mas padrones.", inputSchema: { type: "object", properties: { padrones: { type: "array", minItems: 2, maxItems: 5, items: { type: "object", properties: { department: { type: "string" }, padron: { type: "string" } }, required: ["department", "padron"], additionalProperties: false } } }, required: ["padrones"], additionalProperties: false }, securitySchemes: [{ type: "noauth" }] }, async ({ input }) => {
    const refs = Array.isArray(input.padrones) ? (input.padrones as PadronRef[]) : [];
    const found: PadronRecord[] = []; const missing: PadronRef[] = [];
    for (const ref of refs) { const r = findPadron(ref); if (r) found.push(r); else missing.push(ref); }
    if (found.length === 0) return toolError("No se encontro ninguno.", { found: [], missing });
    return { content: [{ type: "text", text: "Compare " + found.length + " padron(es)." }], structuredContent: { compared: found, missing } };
  });

  server.registerTool("uy_catastro_get_dataset_status", { title: "Estado del dataset", description: "Devuelve el estado del dataset.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, securitySchemes: [{ type: "noauth" }] }, async () => {
    return { content: [{ type: "text", text: "Dataset " + DATASET_STATUS.mode + ": " + DATASET_STATUS.records_loaded + " registros." }], structuredContent: DATASET_STATUS };
  });

  server.registerTool("uy_catastro_get_official_guide", { title: "Guia oficial", description: "Devuelve guia orientativa sobre datos catastrales.", inputSchema: { type: "object", properties: { topic: { type: "string", enum: ["general", "valor_legal", "due_diligence", "propiedad_horizontal"] } }, additionalProperties: false }, securitySchemes: [{ type: "noauth" }] }, async ({ input }) => {
    const topic = String(input.topic || "general");
    const guides: Record<string, string> = { general: "Use esta app para orientacion preliminar. Para certificacion con valor legal, tramite ante la DNC.", valor_legal: "La respuesta de esta app no tiene valor certificante. Para respaldo formal obtenga documentacion de la DNC.", due_diligence: "Verifique existencia y vigencia del padron. Contraste area y regimen con documentacion registral. Confirme valor catastral.", propiedad_horizontal: "Confirme el regimen declarado. Verifique unidad, padron matriz y documentacion complementaria." };
    return { content: [{ type: "text", text: guides[topic] || guides.general }], structuredContent: { topic, guide: guides[topic] || guides.general } };
  });

  server.registerTool("uy_catastro_build_due_diligence_brief", { title: "Brief de due diligence", description: "Construye brief preliminar de due diligence para un padron.", inputSchema: { type: "object", properties: { department: { type: "string" }, padron: { type: "string" }, purpose: { type: "string" } }, required: ["department", "padron"], additionalProperties: false }, securitySchemes: [{ type: "noauth" }] }, async ({ input }) => {
    const record = findPadron({ department: String(input.department), padron: String(input.padron) });
    if (!record) return toolError("No pude construir el brief: padron no encontrado.", { found: false });
    const risks: string[] = [];
    if (!record.vigente) risks.push("Padron no vigente en dataset de referencia.");
    if (!record.address) risks.push("Sin direccion en esta fuente.");
    return { content: [{ type: "text", text: "Brief padron " + record.padron + " en " + record.department + ". Vigente: " + (record.vigente ? "si" : "no") + ". Riesgos: " + (risks.length ? risks.join(" ") : "sin alertas.") }], structuredContent: { summary: record, risks, checks: ["Solicitar constancia oficial de Catastro.", "Cruzar con documentacion registral."] } };
  });

  return server;
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  const server = createCatastroServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) writeJson(res, 500, { ok: false, error: "internal_server_error" });
  }
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) { writeJson(res, 400, { ok: false, error: "missing_url" }); return; }
  const url = new URL(req.url, "http://" + (req.headers.host ?? "localhost"));
  if (req.method === "OPTIONS" && url.pathname.startsWith(MCP_PATH)) {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS", "Access-Control-Allow-Headers": "content-type, mcp-session-id", "Access-Control-Expose-Headers": "Mcp-Session-Id" });
    res.end(); return;
  }
  if (req.method === "GET" && url.pathname === "/") { writeJson(res, 200, { name: "uy-catastro-mcp", ok: true, version: "1.0.0", endpoints: ["/", "/health", "/mcp"], auth: "noauth" }); return; }
  if (req.method === "GET" && url.pathname === "/health") { writeJson(res, 200, { ok: true, service: "uy-catastro-mcp", port: PORT }); return; }
  const mcpMethods = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname.startsWith(MCP_PATH) && req.method && mcpMethods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    await handleMcpRequest(req, res); return;
  }
  writeJson(res, 404, { ok: false, error: "not_found", path: url.pathname });
});

httpServer.listen(PORT, () => { console.log("Uy Catastro MCP server listening on http://localhost:" + PORT + MCP_PATH); });
