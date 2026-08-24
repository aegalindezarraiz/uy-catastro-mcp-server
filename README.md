# Catastro Uruguay MCP

Servidor MCP de consulta preliminar sobre el conjunto oficial de padrones urbanos y rurales publicado por la Dirección Nacional de Catastro de Uruguay.

## Versión 2.2

- Ingiere automáticamente el recurso mensual DNC más reciente durante el build.
- Indexa padrones urbanos y rurales en SQLite para consultas rápidas.
- Distingue localidad urbana, sección rural, régimen, block, piso y unidad.
- Devuelve todos los candidatos cuando departamento + padrón es ambiguo.
- Expone snapshot, publicación, recurso y conteos mediante `uy_catastro_get_dataset_status`.
- Emite la cédula catastral común oficial en PDF mediante el generador público de la DNC.
- Consulta en vivo los planos registrados del Visor DNC y devuelve registro, fecha y agrimensor.
- Enlaza al Archivo Gráfico del MTOP para acceder a las imágenes de planos.
- Incorpora `uy_catastro_estimate_avm`, un AVM D3 trazable basado en características, entorno y testigos verificables.
- Elimina testigos inválidos, duplicados, antiguos, lejanos, de otro tipo y outliers robustos de precio/m².
- Ajusta precio de oferta, tendencia, superficie, estado, estacionamiento y entorno mostrando cada factor.
- Combina mediana ponderada de comparables con regresión hedónica ridge cuando hay al menos 8 testigos útiles.
- Devuelve estimación y rango USD, confianza, modelos, testigos usados/descartados, advertencias y supuestos.
- Elimina direcciones, valores de mercado y estados jurídicos ficticios del antiguo modo demo.

## Límites

El dataset abierto no contiene dirección postal, titularidad, gravámenes, hipotecas, deudas ni valor de mercado. No se identificó una fuente pública nacional de ventas urbanas a nivel de inmueble: el AVM exige testigos aportados con URL de evidencia o por un proveedor autorizado y no raspa portales. Su resultado es orientativo, no una tasación, certificado ni garantía de cierre. La herramienta de emisión devuelve la cédula común generada por la DNC; no sustituye la cédula catastral informada, un estudio de títulos ni el control registral/notarial. La disponibilidad de imágenes de planos depende del Archivo Gráfico del MTOP.

Fuente: [Padrones urbanos y rurales — Catálogo de Datos Abiertos](https://catalogodatos.gub.uy/dataset/direccion-nacional-de-catastro-padrones-urbanos-y-rurales).

Servicios oficiales complementarios:

- [Visor DNC](https://visor.catastro.gub.uy/visordnc/)
- [Cédula catastral](https://www.gub.uy/tramites/cedula-catastral)
- [Archivo Gráfico del MTOP](https://planos.mtop.gub.uy/pesgpm/servlet/hconsulta)

## AVM D3

La herramienta `uy_catastro_estimate_avm` requiere una referencia catastral única, el tipo de propiedad y entre 3 y 100 testigos. La superficie del inmueble sujeto es opcional si el snapshot DNC contiene una superficie compatible. Cada testigo debe declarar:

- identificador, `sold` o `listing`, URL y fecha de observación;
- precio en USD, superficie y tipo de propiedad;
- opcionalmente distancia o coordenadas, dormitorios, baños, estacionamiento, año, estado y entorno.

El entorno puede incluir escuelas a 1 km, paradas a 500 m, parques a 1 km, comercios a 1 km, índice de criminalidad y sus fuentes. Los parámetros oferta/venta y tendencia de mercado son configurables y siempre se devuelven como supuestos. Véase [MARKET_RESEARCH.md](MARKET_RESEARCH.md) para fuentes, cobertura y brechas de producción.

No se utiliza una red neuronal en esta versión: sin una muestra amplia de ventas cerradas y validación fuera de muestra sería menos explicable y más propensa al sobreajuste que el ensamble robusto + ridge.

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
