# Catastro Uruguay MCP

## Value Proposition

Consultar por conversación los datos alfanuméricos públicos de padrones urbanos y rurales publicados por la Dirección Nacional de Catastro (DNC), con trazabilidad del corte mensual y sin presentar datos orientativos o inventados como si fueran oficiales.

**Usuarios principales:** operador inmobiliario, analista OSINT inmobiliario y profesional que necesita una verificación catastral preliminar.

**Dolor actual:** la consulta manual exige conocer la estructura catastral, distinguir localidad urbana de sección rural y comprobar la vigencia del dataset. El servidor anterior devolvía cuatro registros de demostración incrustados, sin cobertura nacional real.

**Acciones principales:**

1. Buscar uno o varios registros catastrales candidatos por departamento y padrón.
2. Comparar registros oficiales con campos homogéneos y trazables.
3. Generar un brief preliminar con límites, vacíos y próximos controles oficiales.
4. Emitir una cédula catastral común oficial para una referencia resuelta de forma única.
5. Consultar planos registrados y metadatos de agrimensor en el Visor DNC.
6. Estimar un rango de valor de mercado mediante un AVM D3 trazable, usando características del inmueble, entorno y testigos aportados con evidencia.

## Why LLM?

**Ventaja conversacional:** el usuario puede pedir “padrón 12345 de Montevideo” o comparar varios padrones sin conocer los códigos internos de departamento, localidad o régimen.

**Aporte del LLM:** interpreta intención, solicita localidad/sección/unidad cuando hay ambigüedad y resume resultados y límites de uso.

**Lo que el LLM no posee:** el snapshot oficial DNC, su esquema, trazabilidad mensual y capacidad de consultar el índice nacional.

## UI Overview

No se incorpora una vista gráfica en esta versión. Los inputs son naturalmente conversacionales y los resultados son registros estructurados breves. Una futura vista de comparación o mapa queda fuera de alcance.

## Product Context

- **Producto existente:** MCP HTTP desplegado en Render y conectado a ChatGPT.
- **Fuente primaria:** conjunto “Padrones urbanos y rurales” del Catálogo de Datos Abiertos de Uruguay, mantenido por la DNC.
- **Fuentes en vivo complementarias:** generador de cédulas de la DNC; tablas de planos y agrimensores del Visor DNC; Archivo Gráfico del MTOP.
- **Corte objetivo:** recurso oficial más reciente disponible durante el build; para esta versión, 08/2026.
- **Licencia:** Licencia de Datos Abiertos de Uruguay declarada por el dataset.
- **Autenticación:** no requerida para el dataset público ni para las consultas MCP.
- **Restricciones de datos:**
  - El dataset no contiene dirección postal, titularidad, gravámenes, hipotecas ni deuda tributaria.
  - El padrón urbano es identificado dentro de una localidad; el número de padrón por departamento puede producir múltiples candidatos.
  - El padrón rural usa sección catastral.
  - La presencia en un snapshot no equivale a certificación legal de vigencia o titularidad.
  - La cédula catastral es el documento con valor legal para certificar el valor catastral base.
  - La cédula común es distinta de la cédula catastral informada; esta última requiere usuario, solicitud y pago en Sede Electrónica.
  - El Visor DNC expone metadatos de planos; el acceso a sus imágenes es provisto y mantenido por el Archivo Gráfico del MTOP.
  - No se identificó una fuente pública nacional de compraventas urbanas a nivel de inmueble. El AVM no inventa ventas: exige testigos proporcionados por el usuario o por un proveedor autorizado.
  - Los precios de oferta no equivalen a precios de cierre. El factor oferta/venta aplicado debe quedar explícito en el resultado.
  - Los indicadores de entorno pueden tener cobertura territorial y fechas diferentes; cada snapshot debe declarar fuente y fecha de medición.

## UX Flows

### Buscar padrón

1. Proporcionar departamento y número de padrón.
2. Aplicar filtros opcionales de régimen, localidad, sección, block, piso o unidad.
3. Devolver cero, uno o varios candidatos con trazabilidad de fuente.

### Comparar padrones

1. Proporcionar dos o más referencias.
2. Resolver cada referencia con los mismos criterios de búsqueda.
3. Devolver coincidencias, ambigüedades y faltantes sin seleccionar silenciosamente un candidato.

### Generar brief preliminar

1. Resolver la referencia catastral.
2. Si es única, generar resumen de superficie, valores catastrales y régimen.
3. Si es ambigua, devolver los filtros necesarios para desambiguar.
4. Incluir límites y controles oficiales pendientes.

### Comprobar frescura

1. Consultar el manifiesto de ingestión.
2. Devolver corte, fecha de publicación, recurso, conteos, modo y estado de disponibilidad.

### Emitir cédula catastral común

1. Resolver una única referencia por departamento, padrón y filtros catastrales.
2. Rechazar referencias inexistentes o ambiguas sin emitir un documento incorrecto.
3. Invocar el generador oficial DNC y validar que la respuesta sea un PDF en el dominio oficial.
4. Devolver el PDF como recurso descargable y mantener trazabilidad del registro usado.

### Consultar planos registrados

1. Resolver una única referencia catastral.
2. Para urbano, convertir los códigos DNC a la localidad numérica usada por el Visor; para rural, usar su numeración departamental.
3. Consultar planes y agrimensores en las tablas públicas del Visor DNC.
4. Devolver número de registro, fecha, tipo y agrimensor, más el enlace al Archivo Gráfico del MTOP.

### Estimar valor de mercado con AVM D3

1. Resolver una única referencia catastral y completar las superficies disponibles desde el snapshot DNC.
2. Recibir características del inmueble, un snapshot opcional del entorno y entre 3 y 100 testigos de venta u oferta con procedencia.
3. Rechazar testigos inválidos, duplicados, futuros, antiguos, lejanos, de otro tipo de propiedad o atípicos por precio/m² mediante MAD robusta.
4. Ajustar cada testigo por oferta/venta, fecha, superficie, estado, estacionamiento y entorno, declarando cada factor aplicado.
5. Calcular un enfoque robusto por comparables y, cuando la muestra lo permite, una regresión hedónica ridge; combinar ambos sin usar una red neuronal no calibrada.
6. Devolver estimación en USD, rango de incertidumbre, precio/m², confianza, modelos usados, testigos usados/descartados, advertencias y supuestos.

## Tools

### `uy_catastro_lookup_padron`

- **Input:** departamento, padrón y filtros catastrales opcionales.
- **Output:** `found`, `ambiguous`, `matches[]`, filtros aplicados y trazabilidad.

### `uy_catastro_compare_padrones`

- **Input:** lista de referencias de padrón con filtros opcionales.
- **Output:** resultados por referencia, coincidencias, ambigüedades y faltantes.

### `uy_catastro_get_dataset_status`

- **Input:** ninguno.
- **Output:** modo, corte, fecha de publicación, recurso, conteos y disponibilidad.

### `uy_catastro_get_official_guide`

- **Input:** tema.
- **Output:** guía breve, límites y enlaces oficiales.

### `uy_catastro_build_due_diligence_brief`

- **Input:** referencia catastral y filtros opcionales.
- **Output:** brief preliminar solo cuando la referencia queda resuelta de forma única.

### `uy_catastro_emit_cedula_catastral`

- **Input:** departamento, padrón y filtros catastrales opcionales.
- **Output:** cédula catastral común oficial en PDF o un error de referencia inexistente/ambigua.

### `uy_catastro_get_registered_plans`

- **Input:** departamento, padrón y filtros catastrales opcionales.
- **Output:** lista de planos registrados con fecha y agrimensor, fuente Visor DNC y acceso al Archivo Gráfico MTOP.

### `uy_catastro_estimate_avm`

- **Input:** referencia catastral; tipo y características del inmueble; entorno opcional; testigos verificables de venta/oferta; fecha y parámetros técnicos opcionales.
- **Output:** `ok`, estimación/rango USD, precio por m², confianza, modelos, testigos normalizados con ajustes, descartes con motivos, supuestos, advertencias y registro DNC usado.
- **Behavior:** requiere referencia única y al menos 3 testigos válidos tras limpieza; usa MAD robusta, ponderación por fuente/recencia/distancia/similitud y regresión ridge solo con muestra suficiente.

## Safety and Evidence Rules

- No devolver datos demo en producción.
- No fabricar direcciones, estado de vigencia, valor de mercado, titularidad o cargas.
- Identificar expresamente el corte mensual y la fuente de cada resultado.
- No llamar “valor real de mercado” al valor catastral.
- No presentar el brief como certificado, tasación ni estudio de títulos.
- Ante ambigüedad, devolver candidatos y pedir el dato faltante.
- No emitir cédula ni consultar planos si la referencia no queda resuelta de forma única.
- Aceptar como PDF oficial únicamente redirecciones al dominio `apls2.catastro.gub.uy`.
- No presentar metadatos del Visor como copia certificada del plano.
- No llamar “tasación”, “certificado” ni “valor real” al resultado AVM; es una estimación automatizada orientativa.
- No usar valor catastral como sustituto silencioso del valor de mercado.
- No aceptar testigos sin identificador, clase de fuente, fecha, precio, superficie y URL de procedencia.
- No mezclar tipos de propiedad; no usar testigos rechazados en el cálculo.
- Mostrar todos los factores y supuestos; si no hay ventas cerradas, limitar la confianza y advertir que el resultado se apoya en oferta.
- No usar una red neuronal hasta disponer de una muestra amplia de ventas verificadas y validación fuera de muestra.
