import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { buildDueDiligenceBrief, type PadronQuery } from "./domain.js";
import { makeLookupOutput, officialGuide } from "./service.js";
import { CatastroStore } from "./store.js";

const VERSION = "2.0.0";
const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const databasePath = resolve(process.env.CATASTRO_DB_PATH ?? "dist/data/catastro.sqlite");

if (!existsSync(databasePath)) {
  throw new Error(`Catastro database not found at ${databasePath}. Run npm run build first.`);
}

const store = new CatastroStore(databasePath);
const querySchema = {
  department: z.string().min(1).describe("Departamento por nombre o código DNC"),
  padron: z.string().regex(/^\d+$/).describe("Número de padrón"),
  regime: z.enum(["CO", "PH", "UH", "RU"]).optional().describe("Régimen catastral"),
  locality: z.string().optional().describe("Localidad urbana por nombre o código DNC"),
  section: z.number().int().nonnegative().optional().describe("Sección catastral rural"),
  block: z.string().optional().describe("Block para PH o manzana para UPH"),
  floor: z.string().optional().describe("Entrepiso o subsuelo"),
  unit: z.number().int().nonnegative().optional().describe("Unidad de propiedad horizontal"),
};

function asQuery(input: Record<string, unknown>): PadronQuery {
  return {
    department: String(input.department),
    padron: String(input.padron),
    ...(input.regime ? { regime: String(input.regime) } : {}),
    ...(input.locality ? { locality: String(input.locality) } : {}),
    ...(input.section !== undefined ? { section: Number(input.section) } : {}),
    ...(input.block !== undefined ? { block: String(input.block) } : {}),
    ...(input.floor !== undefined ? { floor: String(input.floor) } : {}),
    ...(input.unit !== undefined ? { unit: Number(input.unit) } : {}),
  };
}

function createCatastroServer(): McpServer {
  const server = new McpServer({ name: "uy-catastro-mcp", version: VERSION });

  server.registerTool("uy_catastro_lookup_padron", {
    title: "Buscar padrón en DNC",
    description: "Busca coincidencias en el snapshot oficial de padrones urbanos y rurales de la DNC. Puede devolver varios candidatos si falta localidad, sección o unidad.",
    inputSchema: querySchema,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async (input) => makeLookupOutput(store.lookup(asQuery(input))));

  server.registerTool("uy_catastro_compare_padrones", {
    title: "Comparar padrones DNC",
    description: "Compara de 2 a 20 referencias catastrales sin resolver silenciosamente las ambiguas.",
    inputSchema: {
      padrones: z.array(z.object(querySchema)).min(2).max(20).describe("Referencias a comparar"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async (input) => {
    const results = input.padrones.map((reference) => store.lookup(asQuery(reference)));
    const resolved = results.filter((result) => result.matches.length === 1).length;
    const ambiguous = results.filter((result) => result.ambiguous).length;
    const missing = results.filter((result) => !result.found).length;
    return {
      content: [{ type: "text" as const, text: `Comparación completada: ${resolved} resueltos, ${ambiguous} ambiguos y ${missing} sin coincidencias.` }],
      structuredContent: { resolved, ambiguous, missing, results },
    };
  });

  server.registerTool("uy_catastro_get_dataset_status", {
    title: "Estado del dataset DNC",
    description: "Devuelve corte, publicación, recurso, ingestión y conteos del snapshot oficial cargado.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async () => {
    const status = store.getStatus();
    return {
      content: [{ type: "text" as const, text: `Snapshot DNC ${status.snapshot}: ${status.records_loaded} registros (${status.urban_records} urbanos y ${status.rural_records} rurales). Publicado: ${status.published_at}.` }],
      structuredContent: status,
    };
  });

  server.registerTool("uy_catastro_get_official_guide", {
    title: "Guía oficial de Catastro",
    description: "Explica alcance, límites y trámites oficiales aplicables.",
    inputSchema: {
      topic: z.enum(["general", "valor_legal", "due_diligence", "propiedad_horizontal", "data_source"]).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async (input) => {
    const topic = input.topic ?? "general";
    const guide = officialGuide(topic);
    return {
      content: [{ type: "text" as const, text: guide.text + "\n" + guide.links.map((link) => `${link.title}: ${link.url}`).join("\n") }],
      structuredContent: { topic, ...guide },
    };
  });

  server.registerTool("uy_catastro_build_due_diligence_brief", {
    title: "Brief catastral preliminar",
    description: "Genera un brief preliminar basado solo en datos abiertos DNC. No sustituye certificado, tasación ni estudio de títulos.",
    inputSchema: {
      ...querySchema,
      include_valuation: z.boolean().optional().describe("Compatibilidad v1; los valores devueltos son catastrales, no de mercado"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async (input) => {
    const query = asQuery(input);
    const lookup = store.lookup(query);
    const brief = buildDueDiligenceBrief({ query, matches: lookup.matches });
    return {
      content: [{ type: "text" as const, text: brief.text }],
      structuredContent: { ...brief, lookup },
    };
  });

  return server;
}

const app = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "content-type,mcp-session-id" });
    res.end();
    return;
  }
  if (req.url === "/health" || req.url === "/") {
    try {
      const dataset = store.getStatus();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ status: "ok", server: "uy-catastro-mcp", version: VERSION, dataset }));
    } catch (error) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error", message: error instanceof Error ? error.message : "Dataset unavailable" }));
    }
    return;
  }
  if (req.url?.startsWith(MCP_PATH)) {
    try {
      const mcpServer = createCatastroServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => transport.close());
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("[mcp] request failed:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

app.listen(PORT, () => {
  const status = store.getStatus();
  console.log(`[mcp] uy-catastro-mcp v${VERSION} on :${PORT}${MCP_PATH}; DNC ${status.snapshot}; ${status.records_loaded} records`);
});

function shutdown(): void {
  store.close();
  app.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
