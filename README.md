# Catastro Uruguay MCP

Servidor MCP de consulta preliminar sobre el conjunto oficial de padrones urbanos y rurales publicado por la Dirección Nacional de Catastro de Uruguay.

## Versión 2.1

- Ingiere automáticamente el recurso mensual DNC más reciente durante el build.
- Indexa padrones urbanos y rurales en SQLite para consultas rápidas.
- Distingue localidad urbana, sección rural, régimen, block, piso y unidad.
- Devuelve todos los candidatos cuando departamento + padrón es ambiguo.
- Expone snapshot, publicación, recurso y conteos mediante `uy_catastro_get_dataset_status`.
- Emite la cédula catastral común oficial en PDF mediante el generador público de la DNC.
- Consulta en vivo los planos registrados del Visor DNC y devuelve registro, fecha y agrimensor.
- Enlaza al Archivo Gráfico del MTOP para acceder a las imágenes de planos.
- Elimina direcciones, valores de mercado y estados jurídicos ficticios del antiguo modo demo.

## Límites

El dataset abierto no contiene dirección postal, titularidad, gravámenes, hipotecas, deudas ni valor de mercado. La herramienta de emisión devuelve la cédula común generada por la DNC; no sustituye la cédula catastral informada, un estudio de títulos, una tasación ni el control registral/notarial. La disponibilidad de imágenes de planos depende del Archivo Gráfico del MTOP.

Fuente: [Padrones urbanos y rurales — Catálogo de Datos Abiertos](https://catalogodatos.gub.uy/dataset/direccion-nacional-de-catastro-padrones-urbanos-y-rurales).

Servicios oficiales complementarios:

- [Visor DNC](https://visor.catastro.gub.uy/visordnc/)
- [Cédula catastral](https://www.gub.uy/tramites/cedula-catastral)
- [Archivo Gráfico del MTOP](https://planos.mtop.gub.uy/pesgpm/servlet/hconsulta)

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
