import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as service from "../src/service.js";
import type { CatastroRecord } from "../src/domain.js";

function record(overrides: Partial<CatastroRecord> = {}): CatastroRecord {
  return {
    regime: "CO",
    department_code: "V",
    department: "MONTEVIDEO",
    locality_code: "AA",
    locality: "MONTEVIDEO",
    padron: "539",
    block: null,
    floor: null,
    unit: null,
    section: null,
    area_land_m2: 100,
    area_built_m2: 80,
    cadastral_land_value_uyu: 1,
    cadastral_improvements_value_uyu: 2,
    cadastral_total_value_uyu: 3,
    taxable_value_uyu: 3,
    last_declaration_date: null,
    declaration_effective_date: null,
    snapshot: "2026-08",
    source_url: "https://catalogodatos.gub.uy/example.zip",
    ...overrides,
  };
}

test("buildCedulaCatastralIssueUrl reproduces the official DNC common-property request", () => {
  const buildUrl = (service as Record<string, unknown>).buildCedulaCatastralIssueUrl;
  assert.equal(typeof buildUrl, "function");
  assert.equal(
    (buildUrl as (input: CatastroRecord) => string)(record()),
    "https://apls2.catastro.gub.uy:8443/integralevol3produccion/servlet/gub.catastro.integralevol3produccion.apwebimpresioncedulasgeocatastro?C,V,AA,539,,,"
  );
});

test("buildCedulaCatastralIssueUrl uses the official rural request shape for the interior", () => {
  const buildUrl = service.buildCedulaCatastralIssueUrl;
  assert.equal(
    buildUrl(record({ regime: "RU", department_code: "A", department: "CANELONES", locality_code: null, locality: null })),
    "https://apls2.catastro.gub.uy:8443/integralevol3produccion/servlet/gub.catastro.integralevol3produccion.apwebimpresioncedulasgeocatastro?R,A,,539,,,"
  );
});

test("buildCedulaCatastralIssueUrl includes block, floor and unit for horizontal property", () => {
  assert.equal(
    service.buildCedulaCatastralIssueUrl(record({ regime: "PH", department_code: "A", locality_code: "NB", block: "10658", floor: "I", unit: 4 })),
    "https://apls2.catastro.gub.uy:8443/integralevol3produccion/servlet/gub.catastro.integralevol3produccion.apwebimpresioncedulasgeocatastro?H,A,NB,539,10658,I,4"
  );
});

test("buildCedulaCatastralIssueUrl applies the Visor DNC Montevideo and UPH exceptions", () => {
  assert.equal(
    service.buildCedulaCatastralIssueUrl(record({ regime: "RU", section: 17 })),
    "https://apls2.catastro.gub.uy:8443/integralevol3produccion/servlet/gub.catastro.integralevol3produccion.apwebimpresioncedulasgeocatastro?C,V,AA,539,,,"
  );
  assert.equal(
    service.buildCedulaCatastralIssueUrl(record({ regime: "UH", department_code: "A", locality_code: "NB", block: "10658", unit: 4 })),
    "https://apls2.catastro.gub.uy:8443/integralevol3produccion/servlet/gub.catastro.integralevol3produccion.apwebimpresioncedulasgeocatastro?U,A,NB,539,10658,,4"
  );
});

test("issueCedulaCatastral returns the official generated PDF after a safe DNC redirect", async () => {
  const issue = (service as Record<string, unknown>).issueCedulaCatastral;
  assert.equal(typeof issue, "function");
  const calls: Array<{ url: string; redirect?: RequestRedirect }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), redirect: init?.redirect });
    return new Response(null, {
      status: 301,
      headers: { location: "/integralevol3produccion/images/cedulas/V-AA-539.pdf" },
    });
  };

  const result = await (issue as (input: CatastroRecord, fetcher: typeof fetch) => Promise<{ pdf_url: string }>)(record(), fetchImpl as typeof fetch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, "manual");
  assert.equal(result.pdf_url, "https://apls2.catastro.gub.uy:8443/integralevol3produccion/images/cedulas/V-AA-539.pdf");
});

test("issueCedulaCatastral rejects a PDF redirect outside the exact official HTTPS origin", async () => {
  const fetchImpl = async () => new Response(null, {
    status: 301,
    headers: { location: "http://apls2.catastro.gub.uy/integralevol3produccion/images/cedulas/V-AA-539.pdf" },
  });
  await assert.rejects(
    service.issueCedulaCatastral(record(), fetchImpl as typeof fetch),
    /unsafe PDF location/,
  );
});

test("fetchRegisteredPlans resolves an urban locality and joins plan surveyor metadata", async () => {
  const getPlans = (service as Record<string, unknown>).fetchRegisteredPlans;
  assert.equal(typeof getPlans, "function");
  const whereClauses: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    whereClauses.push(url.searchParams.get("where") ?? "");
    if (url.pathname.endsWith("/10/query")) {
      return Response.json({ features: [{ attributes: { NUMLOCCAT: 441 } }] });
    }
    if (url.pathname.endsWith("/7/query")) {
      return Response.json({ features: [{ attributes: {
        NOMDEPTO: "MONTEVIDEO", NOMLOCCAT: "MONTEVIDEO", NUMLOCCAT: 441,
        PLAPADRON: 539, PLAREGPLA: 201, PLAFCHREG: -658281600000, TIPOPLANO: "U",
      } }] });
    }
    if (url.pathname.endsWith("/6/query")) {
      return Response.json({ features: [{ attributes: {
        NUMDEPTO: 19, NUMREGPLANO: 201, FECHAPLANO: -658281600000,
        NOMAGRIM: "OLIVERA CALAMET,ALFREDO             ",
      } }] });
    }
    return Response.json({ error: { message: "unexpected URL" } }, { status: 404 });
  };

  const result = await (getPlans as (input: CatastroRecord, fetcher: typeof fetch) => Promise<{
    plans: Array<{ registry_number: number; registration_date: string; surveyor: string }>;
    archive_url: string;
  }>)(record(), fetchImpl as typeof fetch);

  assert.equal(whereClauses[0], "CODDEPTO = 'V' AND CODLOCCAT = 'AA'");
  assert.match(whereClauses[1], /NUMLOCCAT IN \(441\).*PLAPADRON = 539/);
  assert.equal(result.plans[0].registry_number, 201);
  assert.equal(result.plans[0].registration_date, "1949-02-21");
  assert.equal(result.plans[0].surveyor, "OLIVERA CALAMET,ALFREDO");
  assert.equal(result.archive_url, "https://planos.mtop.gub.uy/pesgpm/servlet/hconsulta");
});

test("fetchRegisteredPlans queries rural plans with the Visor DNC department numbering", async () => {
  const whereClauses: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    whereClauses.push(url.searchParams.get("where") ?? "");
    if (url.pathname.endsWith("/7/query")) {
      return Response.json({ features: [{ attributes: {
        NOMDEPTO: "CANELONES", NOMLOCCAT: null, NUMLOCCAT: null,
        PLAPADRON: 539, PLAREGPLA: 44, PLAFCHREG: 946684800000, TIPOPLANO: "R",
      } }] });
    }
    if (url.pathname.endsWith("/6/query")) {
      return Response.json({ features: [{ attributes: {
        NUMDEPTO: 1, NUMREGPLANO: 44, FECHAPLANO: 946684800000, NOMAGRIM: "AGRIMENSOR UNO",
      } }] });
    }
    return Response.json({ error: { message: "unexpected layer" } }, { status: 404 });
  };

  const result = await service.fetchRegisteredPlans(
    record({ regime: "RU", department_code: "A", department: "CANELONES", locality_code: null, locality: null, section: 8 }),
    fetchImpl as typeof fetch,
  );
  assert.equal(whereClauses[0], "TIPOPLANO = 'R' AND NUMDEPTO = 1 AND PLAPADRON = 539");
  assert.equal(whereClauses[1], "NUMDEPTO = 1 AND NUMREGPLANO IN (44)");
  assert.equal(result.plans[0].plan_type, "rural");
});

test("fetchRegisteredPlans applies the Visor DNC paired-locality exceptions", async () => {
  const whereClauses: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    whereClauses.push(url.searchParams.get("where") ?? "");
    if (url.pathname.endsWith("/10/query")) return Response.json({ features: [{ attributes: { NUMLOCCAT: 405 } }] });
    if (url.pathname.endsWith("/7/query")) return Response.json({ features: [] });
    return Response.json({ features: [] });
  };
  await service.fetchRegisteredPlans(record({ department_code: "B", department: "MALDONADO", locality_code: "ZZ" }), fetchImpl as typeof fetch);
  assert.match(whereClauses[1], /NUMLOCCAT IN \(405,406\)/);
});

test("makeCedulaOutput refuses to emit when the cadastral reference is ambiguous", async () => {
  const makeOutput = (service as Record<string, unknown>).makeCedulaOutput;
  assert.equal(typeof makeOutput, "function");
  let fetchCalled = false;
  const result = await (makeOutput as Function)({
    found: true,
    ambiguous: true,
    query: { department: "MONTEVIDEO", padron: "539" },
    matches: [record(), record({ locality_code: "AB", locality: "OTRA" })],
  }, async () => {
    fetchCalled = true;
    return new Response();
  });
  assert.equal(fetchCalled, false);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.reason, "ambiguous");
});

test("makeCedulaOutput emits a downloadable official DNC PDF for one resolved record", async () => {
  const fetchImpl = async () => new Response(null, {
    status: 301,
    headers: { location: "/integralevol3produccion/images/cedulas/V-AA-539.pdf" },
  });
  const result = await service.makeCedulaOutput({
    found: true,
    ambiguous: false,
    query: { department: "MONTEVIDEO", padron: "539" },
    matches: [record()],
  }, fetchImpl as typeof fetch);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.document_type, "cedula_catastral_comun");
  assert.equal(result.content[1].type, "resource_link");
  const message = result.content[0];
  assert.equal(message.type, "text");
  if (message.type !== "text") assert.fail("Expected a text summary");
  assert.match(message.text, /DNC/i);
  assert.match(message.text, /valor legal/i);
});

test("makeRegisteredPlansOutput refuses an ambiguous cadastral reference", async () => {
  const makeOutput = (service as Record<string, unknown>).makeRegisteredPlansOutput;
  assert.equal(typeof makeOutput, "function");
  const result = await (makeOutput as Function)({
    found: true,
    ambiguous: true,
    query: { department: "MONTEVIDEO", padron: "539" },
    matches: [record(), record({ locality_code: "AB", locality: "OTRA" })],
  });
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.reason, "ambiguous");
});

test("makeRegisteredPlansOutput returns registered-plan metadata and the official MTOP archive", async () => {
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/7/query")) return Response.json({ features: [{ attributes: {
      NOMDEPTO: "CANELONES", NOMLOCCAT: null, PLAPADRON: 539, PLAREGPLA: 44,
      PLAFCHREG: 946684800000, TIPOPLANO: "R",
    } }] });
    return Response.json({ features: [{ attributes: {
      NUMDEPTO: 1, NUMREGPLANO: 44, FECHAPLANO: 946684800000, NOMAGRIM: "AGRIMENSOR UNO",
    } }] });
  };
  const resolved = record({ regime: "RU", department_code: "A", department: "CANELONES", locality_code: null, locality: null, section: 8 });
  const result = await service.makeRegisteredPlansOutput({
    found: true,
    ambiguous: false,
    query: { department: "CANELONES", padron: "539", section: 8 },
    matches: [resolved],
  }, fetchImpl as typeof fetch);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.plans.length, 1);
  assert.equal(result.content[1].type, "resource_link");
  assert.equal(result.content[1].uri, "https://planos.mtop.gub.uy/pesgpm/servlet/hconsulta");
});

test("the MCP registers tools for cadastral certificate issuance, registered plans and AVM", () => {
  const serverSource = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(serverSource, /registerTool\("uy_catastro_emit_cedula_catastral"/);
  assert.match(serverSource, /registerTool\("uy_catastro_get_registered_plans"/);
  assert.match(serverSource, /registerTool\("uy_catastro_estimate_avm"/);
});

test("makeAvmOutput refuses ambiguous cadastral references", async () => {
  const makeOutput = (service as Record<string, unknown>).makeAvmOutput;
  assert.equal(typeof makeOutput, "function");
  const result = await (makeOutput as Function)({
    found: true,
    ambiguous: true,
    query: { department: "MONTEVIDEO", padron: "539" },
    matches: [record(), record({ locality_code: "AB", locality: "OTRA" })],
  }, { subject: { property_type: "apartment" }, comparables: [] });
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.reason, "ambiguous");
});

test("makeAvmOutput uses the resolved DNC built area and returns an auditable estimate", () => {
  const comparables = [1, 2, 3].map((number) => ({
    id: `c${number}`,
    source_kind: "sold" as const,
    source_url: `https://evidence.test/c${number}`,
    observed_at: "2026-07-01",
    price_usd: 150_000 + number * 5_000,
    area_m2: 78 + number,
    property_type: "apartment" as const,
    distance_m: number * 100,
  }));
  const result = service.makeAvmOutput({
    found: true,
    ambiguous: false,
    query: { department: "MONTEVIDEO", padron: "539" },
    matches: [record({ area_built_m2: 80 })],
  }, { subject: { property_type: "apartment" }, comparables, valuation_date: "2026-08-24" });

  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.area_source, "dnc_snapshot");
  assert.equal(result.structuredContent.cadastral_record.area_built_m2, 80);
  assert.match(result.content[0].text, /orientativo/i);
  assert.match(result.content[0].text, /no es una tasación/i);
});
