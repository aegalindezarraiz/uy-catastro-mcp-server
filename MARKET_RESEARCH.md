# Investigación de mercado y datos — AVM D3 Uruguay

Fecha de revisión: 2026-08-24.

## Conclusión ejecutiva

Uruguay dispone de buenas fuentes públicas para Catastro y parte del entorno, pero no se identificó un feed público nacional de compraventas urbanas con precio, ubicación y características a nivel de inmueble. Por eso el AVM D3 se diseña como motor trazable y agnóstico al proveedor: usa el snapshot DNC para identificar el padrón y exige testigos con procedencia aportados por el usuario o por un proveedor autorizado. No raspa portales ni fabrica históricos de ventas.

## Fuentes verificadas

| Dimensión | Fuente | Cobertura útil | Uso en D3 |
|---|---|---|---|
| Inmueble | [Padrones urbanos y rurales — DNC](https://catalogodatos.gub.uy/dataset/direccion-nacional-de-catastro-padrones-urbanos-y-rurales) | Nacional; identificación, régimen, superficies y valores catastrales | Resolver el inmueble y completar superficies; nunca usar el valor catastral como valor de mercado |
| Transporte | [Paradas y recorridos — Intendencia de Montevideo](https://catalogodatos.gub.uy/dataset/transporte-colectivo-paradas-puntos-de-control-y-recorridos-de-omnibus) | Montevideo; capas geográficas de paradas y recorridos | Futuro adaptador geoespacial del entorno |
| Áreas verdes | [Espacios públicos de Montevideo](https://catalogodatos.gub.uy/dataset/?tags=Espacios+p%C3%BAblicos) | Montevideo; plazas, parques y otros espacios públicos | Futuro adaptador geoespacial del entorno |
| Seguridad | [Delitos denunciados — Ministerio del Interior](https://www.gub.uy/ministerio-interior/datos-y-estadisticas/datos-abiertos) | Nacional desde 2013 hasta el último trimestre cerrado | Índice agregado con fecha y geografía explícitas; no inferir riesgo individual |
| Mercado rural | [Serie precio de la tierra — MGAP](https://catalogodatos.gub.uy/dataset/?groups=economia&license_id=odc-uy&res_format=XLSX) | Compraventas agropecuarias agregadas desde 2000 | Tendencia rural; no sirve como testigo urbano individual |
| Oferta urbana | [Evolución de precios de oferta — BCU](https://www.bcu.gub.uy/Estadisticas-e-Indicadores/estudios/Documents/sheppard2025.pdf) | Estudio de avisos de venta en Montevideo | Sustenta separar precio de oferta de precio de cierre |
| Metodología | [Modelos hedónicos para precios de inmuebles — BCU](https://www.bcu.gub.uy/Estadisticas-e-Indicadores/Documentos%20de%20Trabajo/11.2013.pdf) | Investigación aplicada a Uruguay | Sustenta el componente de regresión hedónica |

## Decisiones de producto

1. El MVP no conecta automáticamente a un portal de avisos sin API/permiso documentado.
2. Cada testigo debe incluir identificador, venta u oferta, URL, fecha, precio USD, superficie y tipo de propiedad.
3. La limpieza usa reglas determinísticas y detección robusta por desviación absoluta mediana (MAD).
4. El enfoque principal es comparable técnico ponderado; una regresión ridge hedónica se incorpora solo con al menos 8 testigos válidos y variables suficientes.
5. No se usa red neuronal: con muestras pequeñas sería menos explicable y más propensa al sobreajuste.
6. El resultado incluye intervalo y confianza, no un único número presentado como certeza.

## Brechas para producción

- Contratar o integrar un feed autorizado de ventas cerradas urbanas y otro de oferta vigente.
- Geocodificar padrones fuera de Montevideo y normalizar coberturas departamentales.
- Construir snapshots versionados de escuelas, transporte, áreas verdes, comercios y delitos.
- Calibrar coeficientes y factor oferta/venta por zona y tipo de propiedad.
- Medir MAE, MdAPE, sesgo por zona y cobertura del intervalo sobre un conjunto de prueba temporal fuera de muestra.
