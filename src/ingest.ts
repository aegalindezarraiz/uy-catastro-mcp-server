import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import unzipper from "unzipper";

import { ingestEntries, promoteDatabase, removeDatabaseArtifacts, selectLatestResource, type CatalogResource } from "./ingest-lib.js";

const DEFAULT_CATALOG_API = "https://catalogodatos.gub.uy/api/3/action/package_show?id=direccion-nacional-de-catastro-padrones-urbanos-y-rurales";
const TARGET_FILES = new Set(["Departamentos.csv", "Localidades.csv", "Padrones Urbanos.csv", "Padrones Rurales.csv"]);

type CatalogResponse = {
  success: boolean;
  result?: { resources?: CatalogResource[] };
};

async function resolveResource() {
  if (process.env.DNC_RESOURCE_URL && process.env.DNC_SNAPSHOT) {
    return {
      id: process.env.DNC_RESOURCE_ID ?? "environment-override",
      name: `Datos de padrones urbanos y rurales ${process.env.DNC_SNAPSHOT}`,
      format: "zip csv",
      url: process.env.DNC_RESOURCE_URL,
      last_modified: process.env.DNC_PUBLISHED_AT ?? new Date().toISOString(),
      snapshot: process.env.DNC_SNAPSHOT,
    };
  }
  const response = await fetch(process.env.DNC_CATALOG_API ?? DEFAULT_CATALOG_API, {
    headers: { "user-agent": "uy-catastro-mcp/2.0 (+https://github.com/aegalindezarraiz/uy-catastro-mcp-server)" },
  });
  if (!response.ok) throw new Error(`DNC catalog request failed with HTTP ${response.status}`);
  const payload = await response.json() as CatalogResponse;
  if (!payload.success || !payload.result?.resources) throw new Error("DNC catalog returned an invalid response");
  return selectLatestResource(payload.result.resources);
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { headers: { "user-agent": "uy-catastro-mcp/2.0" } });
  if (!response.ok || !response.body) throw new Error(`DNC archive download failed with HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination));
}

async function main(): Promise<void> {
  const resource = await resolveResource();
  const databasePath = resolve(process.env.CATASTRO_DB_PATH ?? "dist/data/catastro.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  const archivePath = resolve(tmpdir(), `dnc-${resource.snapshot}-${randomUUID()}.zip`);
  const buildDatabasePath = resolve(tmpdir(), `catastro-${resource.snapshot}-${randomUUID()}.sqlite`);

  console.log(`[ingest] downloading DNC snapshot ${resource.snapshot}`);
  try {
    await download(resource.url, archivePath);
    const archive = await unzipper.Open.file(archivePath);
    const files = archive.files.filter((file) => TARGET_FILES.has(file.path.split("/").pop() ?? file.path));
    if (files.length !== TARGET_FILES.size) {
      throw new Error(`DNC archive is missing required files: found ${files.length}/${TARGET_FILES.size}`);
    }
    const entries = files.map((file) => ({ path: file.path, stream: file.stream() as Readable }));
    const manifest = await ingestEntries({
      databasePath: buildDatabasePath,
      snapshot: resource.snapshot,
      resourceId: resource.id,
      sourceUrl: resource.url,
      publishedAt: resource.last_modified ?? new Date().toISOString(),
      entries,
    });
    promoteDatabase(buildDatabasePath, databasePath);
    console.log(`[ingest] completed ${manifest.snapshot}: ${manifest.urban_records} urban + ${manifest.rural_records} rural records`);
  } finally {
    rmSync(archivePath, { force: true });
    removeDatabaseArtifacts(buildDatabasePath);
  }
}

main().catch((error) => {
  console.error("[ingest] fatal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
