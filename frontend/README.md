# Subsarr frontend

Next.js 16 App Router. Interfaz para una instalación de confianza en LAN, sin
login. Las credenciales de IA se guardan en el backend y no se vuelven a pedir
por dispositivo o al abrir la página.

## Pantallas

- **Biblioteca** `/`: búsqueda, filtros y páginas en el backend; agrupación por
  serie/temporada, películas y sin clasificar. Selección completa de grupos o
  coincidencias mediante IDs, no limitada a la página cargada. Panel de detalle
  reutilizado por `/library/[id]`, con pistas, sidecars, reglas e historial.
- **Actividad** `/activity`: Cola, Historial y Logs. Reemplaza `/jobs` y `/archive`.
  Estados desconectados/desactualizados no se presentan como una cola sana vacía.
- **Traducción rápida** `/quick-translate`: arrastrar o elegir varios SRT, ASS/SSA
  y VTT, progreso/cancelación por archivo, descarga individual o ZIP. Sin relación
  con biblioteca o jobs; sesiones en memoria y retención de una hora al terminar.
- **Resumen** `/dashboard`: estado accionable, uso/presupuesto, métricas y gráficos.
- **Renombrar** `/rename`: preview/diff editable, clasificación/metadatos, sidecars,
  conflictos, ejecución y deshacer. Acceso secundario desde Herramientas/Más.
- **Ajustes** `/settings`: Proveedores, Idiomas y calidad, Biblioteca y escaneo,
  Automatización, Integraciones y Avanzado. La barra de guardado conserva borradores
  aunque fallen consultas auxiliares; los avisos de secretos permiten repararlos.

`Ctrl+K` / `Cmd+K` abre comandos. En móvil hay cuatro destinos principales y Más;
los diálogos mantienen el foco y Escape lo devuelve al control que los abrió.
Las notificaciones son de sesión, no un historial permanente; el replay de eventos
está acotado. El navegador comparte una conexión de jobs por pestaña y la pausa
cuando queda oculta. SSE de traducción rápida pertenece a su sesión independiente.

## Desarrollo y build

```sh
pnpm install --frozen-lockfile
pnpm run dev
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run start
```

Node 24 es la versión de la imagen. Fuentes e iconos no necesitan Google Fonts.
La imagen conserva el entrypoint/config generado de Next pero instala el grafo
completo de dependencias de producción desde el lockfile, sin copiar el subconjunto
`node_modules` de los traces. Esto evita omisiones observadas en el standalone;
hay una comprobación de dependencias durante la construcción de la imagen.
En desarrollo configurar `API_INTERNAL_URL` hacia el backend correspondiente;
el navegador siempre usa `/api`. Para imágenes, las rewrites de Next se resuelven
al construir: por defecto apuntan a `http://api:3001`, la red de Compose. Otra
topología requiere revisar ese destino durante el build, no solo cambiar una
variable después de publicar la imagen.

## Contratos y cliente API

`lib/types.ts` es generado, no editarlo a mano. Desde la raíz:

```sh
node scripts/generate-contracts.cjs
node scripts/generate-contracts.cjs --check
```

`apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete` aceptan `RequestInit` y
`AbortSignal`; uploads usan `FormData`, downloads usan `apiDownload`. Solo GET
reintenta fallos transitorios. Ninguna mutación se reintenta automáticamente:
una respuesta perdida no autoriza a encolar otra traducción pagada.

El hook `useApiQuery` cancela respuestas obsoletas y evita refrescos solapados;
cambiar la frecuencia no borra datos anteriores. Las pantallas distinguen carga,
resultado vacío, error y datos anteriores desactualizados. Búsquedas se sincronizan
con la URL; páginas/filtros y commits de búsqueda mantienen navegación Atrás.

## Verificación

No se añadió un framework de tests frontend. Regresiones de lógica pura usan
Node 24 y su runner nativo:

```sh
node --test app/settings/settings-validation.test.mjs components/library/library-filters.test.mjs
```

Además de lint/typecheck/build, verificar visualmente a 390 y 1440 px: nombres
largos, búsqueda y Atrás, selección entre páginas, teclado/foco de diálogos,
notificaciones sobre la navegación, carga fallida y conservación de borradores.
Las pruebas con fixtures de navegador no prueban al proveedor IA real.

Los permisos de volúmenes, respaldo de la clave de cifrado, presupuesto, límites
multifichero y actualización compatible se documentan en `../backend/README.md`.
