# Catastro Uruguay MCP

Servidor MCP de consulta preliminar sobre el conjunto oficial de padrones urbanos y rurales publicado por la Dirección Nacional de Catastro de Uruguay.

## Versión 2.0

- Ingiere automáticamente el recurso mensual DNC más reciente durante el build.
- Indexa padrones urbanos y rurales en SQLite para consultas rápidas.
- Distingue localidad urbana, sección rural, régimen, block, piso y unidad.
- Devuelve todos los candidatos cuando departamento + padrón es ambiguo.
- Expone snapshot, publicación, recurso y conteos mediante `uy_catastro_get_dataset_status`.
- Elimina direcciones, valores de mercado y estados jurídicos ficticios del antiguo modo demo.

## Límites

El dataset abierto no contiene dirección postal, titularidad, gravámenes, hipotecas, deudas ni valor de mercado. Los resultados no sustituyen la cédula catastral, un estudio de títulos, una tasación ni el control registral/notarial.

Fuente: [Padrones urbanos y rurales — Catálogo de Datos Abiertos](https://catalogodatos.gub.uy/dataset/direccion-nacional-de-catastro-padrones-urbanos-y-rurales).

## Desarrollo

```bash
npm install
npm test
npm run typecheck
npm run build
npm start
```

Endpoints:

- MCP: `POST /mcp`
- Salud y manifiesto: `GET /health`

Variables opcionales:

- `PORT`
- `CATASTRO_DB_PATH`
- `DNC_CATALOG_API`
- `DNC_RESOURCE_URL`, `DNC_SNAPSHOT`, `DNC_RESOURCE_ID`, `DNC_PUBLISHED_AT` para fijar un recurso concreto.
