# Subsarr backend

API NestJS para inventariar medios, traducir subtítulos con IA y administrar tareas
persistentes con Bull/Redis. Node 24 y SQLite (`better-sqlite3`). Pensado para una
LAN de confianza: no incorpora login ni exige volver a introducir API keys al
abrir la página desde otro dispositivo. No exponer directamente a Internet.

## Desarrollo y verificación

```sh
pnpm install --frozen-lockfile
pnpm run start:dev
pnpm run build
pnpm run lint           # comprobación, no modifica archivos
pnpm run lint:fix       # correcciones explícitas
pnpm run format:check
pnpm run typecheck
pnpm test --runInBand
REDIS_URL=redis://127.0.0.1:6379/15 pnpm run check:upgrade   # tras build
```

`check:upgrade` (`../scripts/check-upgrade.cjs`) siembra una base en el esquema
más antiguo con secretos en claro, filas de tokens y un job archivado; arranca
`dist/main.js` dos veces con datos temporales, comprueba que todas las migraciones
se aplican, que los datos sobreviven cifrados/intactos, que el segundo arranque no
cambia nada y que SIGTERM cierra limpio. Usar una base Redis desechable: el script
rechaza colas `bull:translation:*` existentes y limpia las suyas.

CI (`.github/workflows/verify.yml`): Node 24, `pnpm install --frozen-lockfile` en
ambos paquetes, lint, typecheck, tests, build, contratos y `check:upgrade` con un
servicio Redis. El workflow de imágenes depende de esa verificación, mantiene
ejecución manual y no llama a ningún webhook de despliegue.

Redis es necesario para el backend completo. Usar un Node compatible con los
módulos nativos instalados; no reconstruir `better-sqlite3` para otro Node si se
quiere conservar la instalación existente. Los contenedores usan Node 24.

Desde la raíz del repositorio:

```sh
node scripts/generate-contracts.cjs
node scripts/generate-contracts.cjs --check
```

Los contratos públicos son declaraciones puras del backend; el generador produce
`frontend/lib/types.ts`, incluido en Git para que la imagen frontend no necesite
el árbol del backend. No editar directamente el archivo generado.

## Actualización de una instalación existente

1. Detener ordenadamente el backend y respaldar el volumen de datos completo,
   SQLite, sus posibles archivos auxiliares y cualquier clave de cifrado externa.
   Conservar la imagen anterior para recuperación. Las migraciones modifican el
   esquema; volver únicamente a una imagen vieja no sustituye restaurar el backup.
2. Mantener los mismos volúmenes y rutas de medios. Las migraciones añaden el
   inventario, historial de renombrado, contabilidad de proveedores y estado del
   scheduler. Los logs históricos no se eliminan indiscriminadamente.
3. **No se cambia de usuario automáticamente:** con `PUID` y `PGID` vacíos, imagen
   y Compose conservan el comportamiento anterior como root, con advertencia.
   No hay `chown` automático en ese caso. El antiguo `PUID=0 PGID=0` explícito
   también conserva esa ruta legacy; no activa una migración de propietarios.
4. Para reducir privilegios, preparar primero permisos/ACL de escritura en medios
   y el mapeo de UID/GID de Proxmox/LXC. Después configurar explícitamente ambos
   `PUID` y `PGID` no nulos. El entrypoint arranca como root, migra propietarios
   solo dentro del directorio de datos y ejecuta el proceso con ese UID/GID.
   Nunca cambia propietarios de `/app` ni de los medios. No forzar `user:` antes
   de esa preparación. Un arranque ya no-root verifica permisos y da un error
   accionable si la base, settings, clave o medios no son accesibles.
5. Tras actualizar, revisar `/health`, los avisos de Ajustes y los logs del primer
   escaneo. Un inventario/caché antiguo puede necesitar reconstrucción inicial.

Se retiró el despliegue automático de Coolify del workflow. GitHub comprueba
contratos y construye/publica imágenes, tanto por push como por ejecución manual;
un push ya no despliega. El despliegue queda a cargo del operador.

### Comprobación desde el esquema anterior

Se verificó el backend compilado (`node dist/main.js`) en Linux con Node 24 y
una instalación limpia de dependencias de producción. La base temporal comenzó
solo con migraciones 0000–0002, claves en texto plano, cron de un minuto,
concurrencia 20, TTL antiguo, tokens, snapshots, logs y caché de probes, además
de JSON legacy coexistente. Dos arranques aplicaron 0003–0006 una sola vez:
credenciales descifrables, tokens e historial conservados, y sin recifrado ni
cambios en datos persistentes durante el segundo arranque. Solo se renovó el TTL
de la caché operativa de biblioteca. Esto no reemplaza respaldar la base real.

El entrypoint habilita hooks de `SIGTERM` y `SIGINT`. La comprobación usó señales
Linux reales y streams SSE abiertos: finalizaron antes de salir del proceso.

## Persistencia y credenciales

- `SUBSYNC_DATA_DIR`: datos persistentes; en Compose, `/data`.
- `SUBSYNC_DATABASE_PATH`: por defecto `subsarr.db` dentro de ese directorio.
- `SUBSYNC_MEDIA_DIRS`: raíces autorizadas, separadas por comas. Las carpetas
  elegidas en la UI deben estar dentro de ellas; no amplían el perímetro de acceso.
  El explorador muestra ese perímetro para poder cambiar la selección. Inventario
  y renombrado operan sobre la selección de `settings.mediaDirs`, pero la validan
  también contra el entorno; un valor legacy amplio no amplía la autorización.
- SQLite configura `busy_timeout=5000`. **No activa ni desactiva WAL**: no todos los
  bind mounts tienen las mismas garantías de bloqueo. Usar backups coherentes con
  SQLite, no copiar una base abierta ignorando sus archivos auxiliares.
- Claves OpenRouter, DeepSeek, Telegram, Jellyfin y TMDB se cifran con AES-256-GCM.
  `SUBSARR_SECRET_KEY` puede contener una clave de 32 bytes (64 caracteres hex o
  base64); sin ella se crea atómicamente `subsarr-secret.key` en datos, con permisos
  0600 donde el sistema los soporte. **Respaldar esta clave junto con la base.**
- Una copia de la base sin la clave protege los secretos; quien obtiene ambos
  puede descifrarlos. El cifrado no reemplaza permisos del volumen ni aislamiento.
- Las keys guardadas no se envían al navegador. Los campos vacíos/máscaras no
  reemplazan claves existentes. Ajustes permite reemplazar o borrar explícitamente
  una credencial. Un secreto ilegible genera un aviso por campo y conserva su
  ciphertext durante cambios no relacionados.
- Exportaciones excluyen secretos por defecto. `includeSecrets=true` es una
  decisión explícita; si una clave es ilegible, esa exportación falla en vez de
  presentar una copia incompleta como válida. Importación ZIP: 2 MiB comprimidos,
  8 MiB descomprimidos, entradas y contenidos validados antes de escribir.
- La importación legacy conserva datos de recuperación y crea backups cifrados;
  restaurarlos requiere la clave original. Fallos de autenticación o persistencia
  no se ocultan descartando credenciales.

## Biblioteca, inventario y búsquedas

El inventario persiste entre reinicios. Cada reconciliación recorre directorios,
pero reutiliza metadatos de videos sin cambios; revisa subtítulos externos incluso
si el video no cambió. Caché de probes leída por lotes y escrituras transaccionales
acotadas, con checkpoints durante escaneos largos.

- Pool continuo: `SUBSYNC_PROBE_CONCURRENCY` (10 por defecto), no lotes que esperen
  al archivo más lento. `ffprobe` pide solo pistas de subtítulos, timeout 15 s,
  stderr limitado a 4 KiB.
- Caché válida por ruta, tamaño y mtime. Fallos se recuerdan cinco minutos y se
  reintentan antes si cambia el archivo. Un fallo no elimina el medio ni sidecars.
- `probeStatus`: `ok`, `failed`, `skipped`. Un probe correcto sin pistas no equivale
  a un error. Archivos omitidos por tamaño siguen visibles.
- Una raíz configurada inaccesible hace fallar el escaneo, conserva la biblioteca
  anterior y no actualiza `lastSuccessAt`. Lecturas parciales de subdirectorios o
  sidecars conservan los registros previos afectados, no los de toda la biblioteca.
- Agrupación conservadora serie/temporada/episodio, película y sin clasificar. Los
  indicadores cuentan archivos inventariados con/sin el idioma destino; no afirman
  conocer todos los episodios que debería contener una serie.
- Búsqueda insensible a acentos/mayúsculas y separadores de releases, palabras en
  distinto orden, frases entre comillas, `lang:es`, `missing:es`, `type:movie` y
  códigos de episodio. No elimina años ni etiquetas técnicas del texto buscable.

HTTP:

- `GET /library`: `{items,total,offset,limit}`, con búsqueda/filtros/orden en SQLite.
- `GET /library/groups`: grupos, temporadas, carpetas y conteos de idioma destino.
- `GET /library/ids`: selección de coincidencias completa, no solo la página actual.
- `GET /library/scan-status`: estado/métricas sin iniciar un escaneo.
- `POST /library/rescan`: solicita escaneo en segundo plano.

La UI usa `/api/...`. Los lotes de biblioteca se dividen en solicitudes de hasta
500 archivos y muestran resultados/rechazos parciales sin descartar IDs restantes.

### Diagnóstico del escaneo

Stdout contiene JSON con `scanId`. Inicio, progreso cada cinco segundos y final
incluyen métricas; eventos por archivo/carpeta solo llevan detalles locales.

```sh
docker compose logs --follow --since=30m api
curl http://localhost:3000/api/library/scan-status
```

En un LXC sin Compose, consultar el journal/stdout del gestor del proceso. Estos
son logs del escáner, no entradas de la pantalla de logs de jobs. Incluyen rutas:
tratarlos como metadatos potencialmente sensibles. Compose rota los logs.

| Métricas | Interpretación |
| --- | --- |
| `wallTimeMs`, `discoveryWallTimeMs`, `buildWallTimeMs` | Tiempo transcurrido del escaneo y fases. |
| `statDurationMs`, `cacheReadDurationMs`, `cacheWriteDurationMs`, `probeDurationMs`, `sidecarReadDurationMs` | Sumas de operaciones concurrentes; pueden superar el tiempo de pared. |
| `cacheHits`, `negativeCacheHits`, `cacheMisses` | Reutilización correcta, fallos en backoff y trabajo nuevo. |
| `probes`, `probeErrors`, `probeTimeouts` | Intentos y fallos; timeouts son subconjunto de errores. |
| `probeP50Ms`, `probeP95Ms`, `probeMaxMs` | Latencias de probes completados; null si no hubo probes. |
| `directoryErrors`, `sidecarReadErrors`, `statFailures`, `itemFailures` | Distinguen recorrido, sidecars y archivos fallidos. |
| `roots`, `discoveredFiles`, `processedFiles`, `itemCount` | Trabajo y resultados por escaneo/raíz. |

Comparar el primer escaneo y otro sin cambios, conservando resúmenes y warnings
con el mismo `scanId`. No extrapolar una prueba pequeña a toda la biblioteca.

### Descargas en curso, watcher e historial

- Se ignoran `*.part`, `*.partial`, `*.crdownload` y `*.tmp`. Un video con mtime
  de menos de 30 s, o cuyo tamaño/mtime cambia entre observaciones, queda
  `probeStatus: 'pending'`: no se analiza ni se encola automáticamente hasta estar
  estable. Archivos antiguos se analizan de inmediato.
- `SUBSYNC_WATCH_ENABLED=true` (por defecto `false`) activa `fs.watch` por
  directorio visitado, máximo 2.048, agrupando eventos 2 s y reconciliando solo
  los directorios afectados, sin solaparse con un escaneo en curso. El escaneo
  periódico completo sigue siendo la recuperación ante eventos perdidos.
- Se guardan los últimos 100 escaneos (métricas, fases, hasta 50 fallos y 20
  archivos lentos por escaneo): `GET /library/scans`, `/library/scans/:id`,
  `/library/scans/:id/export` (solo nombres de archivo salvo `?redact=false`) y
  `GET /library/watch-status`.

## Traducción y presupuesto

SRT, ASS/SSA y WebVTT comparten parser/documento y motor. Se preservan tiempos,
identificadores, estructura y markup protegido; entradas o respuestas inválidas
no se presentan como una traducción correcta copiando silenciosamente el original.
Los saltos internos de cada cue también se conservan en la salida de IA: si
cambian, se solicita corrección y se rechaza la salida si persiste el cambio. No se
aplica reflow automático. Las ediciones manuales en `/review` y las traducciones
humanas subidas sí pueden redistribuir líneas; el markup protegido se exige siempre.

BOM/UTF-8/UTF-16 y codificaciones legacy detectadas con suficiente confianza se
manejan explícitamente; ambigüedades dan errores accionables.

DeepSeek, OpenRouter y OpenCode Go comparten SDK compatible con OpenAI y
limitadores por proveedor en el proceso (5 DeepSeek, 3 OpenRouter, 2 Go), incluidos
correcciones y fallbacks. El glosario guardado se aplica a todos los flujos.
Verificación estructural siempre activa; verificación semántica configurable. SDK
sin reintentos ocultos.

La contabilidad registra cada respuesta, aunque su contenido sea rechazado,
separando cache-hit/miss y proveedor/modelo. Precios DeepSeek configurables con
fecha/fuente. OpenRouter usa el costo reportado cuando existe; si falta en un
modelo pago se identifica la estimación con tarifas DeepSeek, no se declara gratis.

- Aviso al 80% del presupuesto mensual estimado.
- Al 100%, no se admiten nuevas traducciones automáticas pagadas.
- Las manuales requieren confirmar el override; una traducción ya admitida no se
  corta a mitad por cruzar el presupuesto. No es un tope financiero del proveedor.
- Un modelo OpenRouter no es gratuito solo por ser OpenRouter: debe ser
  `openrouter/free` o terminar en `:free`.
- Fallback a DeepSeek solo ante agotamiento explícito permitido, con control de
  presupuesto. Un 429 transitorio no implica gasto automático; la cuota diaria
  genérica puede verificarse con `/api/v1/key` según la
  [documentación de OpenRouter](https://openrouter.ai/docs/api_reference/limits).

### Proveedor y modelo predeterminados

Ajustes guarda un proveedor predeterminado (`SUBSYNC_DEFAULT_PROVIDER`, por defecto
`openrouter`) y un modelo por proveedor. Prioridad: selección explícita de la
operación > perfil > predeterminado. Un modelo siempre pertenece al proveedor
elegido. Jobs, lotes y traducción rápida congelan proveedor/modelo al crearse;
cambiar el predeterminado solo afecta trabajos futuros y los reintentos conservan
el snapshot.

### OpenCode Go (suscripción)

- `OPENCODE_GO_API_KEY` (o Ajustes, cifrada) y `OPENCODE_GO_MODEL` (por defecto
  `glm-5.2`). Endpoint `https://opencode.ai/inference/go/openai/v1/chat/completions`.
- Solo modelos documentados compatibles con chat OpenAI. `GET
  /settings/opencode-go/models` consulta el catálogo remoto (timeout 5 s, respuesta
  limitada a 256 KiB, caché 5 min) y, si falla, devuelve la lista documentada con
  un aviso explícito.
- Peticiones honestas: `User-Agent: Subsarr/<versión>` y `x-opencode-session`
  estable por documento. Go está pensado para agentes de programación; la
  aceptación del uso para subtítulos no está verificada.
- El consumo se registra como `subscription`, con `costUsd = 0` como "sin cargo
  adicional asumido", no como gratis ni con tarifas inventadas. No consume el
  presupuesto mensual pago. Desactivar Extra Usage en la consola de OpenCode para
  evitar cargos externos; la app no lo activa.
- Sin fallback automático de Go a proveedores pagos; 401/403/429 fallan con un
  error claro.

### Modos de calidad, checkpoints y memoria

- `qualityMode`: `fast` (actual), `balanced` (genera una hoja de contexto breve a
  partir de inicio/medio/final ≤ 8 KB y la reutiliza) y `review` (balanced + revisión
  IA solo de cues sospechosos, máximo 100 en tandas de 60). Ambos añaden consumo
  contabilizado. `contextHint` opcional del usuario.
- Checkpoints de jobs de biblioteca: identidad SHA-256 de bytes, idiomas,
  proveedor, modelo, glosario, modo, verificación, memoria, contexto y revisión del
  prompt. Se guardan solo chunks validados; reanudar no repite consumo. Retención
  30 días y máximo 100. `GET/DELETE /translation-checkpoints`. La traducción rápida
  es siempre efímera: nunca escribe texto ni checkpoints.
- Memoria de traducción: solo entradas aprobadas manualmente, coincidencia exacta de
  texto, contexto vecino, idiomas y glosario/estilo; máximo 10.000.
  `GET/POST/DELETE /translation-memory`. Entradas cuya división de líneas ya no
  encaja con la política del motor no se reutilizan.
- Informe de legibilidad determinista por cue (20 caracteres/s, 42 por línea,
  2 líneas, duración ≥ 500 ms): son avisos, nunca cambian tiempos.

### Revisión de subtítulos (`/subtitle-workspace`)

Sesiones en memoria (máximo 20, 20 MiB, una hora sin actividad) creadas subiendo
fuente y traducción opcional, desde un sidecar de la biblioteca
(`POST /subtitle-workspace/library/:mediaId`, solo rutas listadas del item o del
historial) o desde un resultado de traducción rápida
(`POST /quick-translate/:id/files/:fileId/workspace`). Edición con
`expectedRevision` (409 si cambió), retraducción asíncrona de cues seleccionados
con operación cancelable, edición del contexto, aprobación explícita a memoria,
descarga y guardado explícito en la biblioteca (409 si el destino existe y no se
permitió sobrescribir).

## Traducción rápida de archivos

`/quick-translate` acepta arrastrar o elegir varios SRT/ASS/SSA/VTT. No crea items
bibliotecarios ni jobs Bull ni escribe subtítulos en disco. Configuración y keys
se resuelven en el servidor, y el consumo sí cuenta en el presupuesto.

- 20 archivos, 2 MiB por archivo, 20 MiB por lote y 10.000 cues por archivo.
- FIFO, memoria y admisiones acotadas; errores de capacidad se muestran antes de
  iniciar trabajo pagado cuando sea posible.
- POST devuelve IDs inmediatamente. `requestId` evita duplicados y permite
  recuperar una admisión cuya respuesta se perdió. Nunca reintentar POST a ciegas.
- Progreso/reconexión por SSE y consulta de estado; cancelar aborta el trabajo.
- Descarga individual `nombre.<idioma>.<ext>` o ZIP con nombres únicos.
- Retención de una hora desde el estado terminal; no expira mientras está en cola
  o traduciendo. Reiniciar el backend pierde estas sesiones efímeras.
- El resultado de cada archivo informa proveedor, modelo, tier, tokens y resumen de
  legibilidad. Abrir en revisión copia fuente/resultado a una sesión de
  `/subtitle-workspace`; ambos permanecen en memoria hasta que expira el lote.

## Evaluación de traducciones

Corpus original versionado en `benchmarks/subtitles/v1` (humor, modismos, diálogo
rápido, canciones, anime y terminología en SRT/ASS/VTT), con referencias humanas.
Puede reemplazarse con `SUBSYNC_EVALUATION_CORPUS_DIR`.

```sh
# Offline, sin IA: valida ids, tiempos, markup, legibilidad, terminología y distancia léxica
node ../scripts/evaluate-translations.cjs --candidate-dir benchmarks/subtitles/v1
# En vivo: consume cuota del proveedor elegido mediante la API en ejecución
node ../scripts/evaluate-translations.cjs --live --endpoint http://127.0.0.1:3001 \
  --provider opencode-go --model glm-5.2 --input humor --quality-mode balanced
```

API: `POST /evaluations/run`, `GET /evaluations/:id`, `/:id/report`,
`POST /:id/cancel`; respeta presupuesto y contabilidad. Las métricas automáticas son
aproximaciones estructurales/léxicas, no una medida de calidad lingüística; la
rúbrica humana (fidelidad, naturalidad, voz, humor, consistencia) queda vacía hasta
revisarla. Informes en memoria: máximo 100, una hora.

## Jobs, actividad y retención

Redis/Bull se mantienen. Cancelar un job activo solicita parada cooperativa y
muestra `cancelling` hasta que el worker termina; no se elimina un registro como
sustituto de detener extracción/IA/publicación. Interrupciones de servidor no se
etiquetan como cancelaciones del usuario. Reclamos de salida e IDs evitan trabajos
concurrentes duplicados; prioridades se actualizan sin borrar/recrear jobs.

`POST /jobs/batch/preview` y `POST /jobs/batch` aceptan el campo opcional
`provider` (`deepseek` u `openrouter`), incluido en las opciones del formulario
de lotes. La previsualización comprueba elegibilidad sin invocar al proveedor;
el encolado conserva la selección para la traducción. Otros valores se rechazan
con HTTP 400.

`/activity` reemplaza las antiguas pantallas `/jobs` y `/archive`: Cola, Historial
y Logs. Fechas, texto, conteos y paginación de logs se ejecutan en SQL. El stream
`/jobs/stream` tiene heartbeats cada 15 s, IDs y replay de hasta 1.000 eventos/10 min;
la UI comparte una conexión por pestaña, pausa oculta y reconcilia por polling.
Notificaciones de sesión no equivalen a un registro permanente de todos los eventos.

Logs: 30 días y máximo 50.000 filas, con mantenimiento acotado; detalle por job
limitado. Archivo: hasta 500 snapshots, sin duplicar logs extensos nuevos en JSON.
Los estados conocidos/pendientes del scheduler persisten entre reinicios: un
archivo nuevo con probe fallido puede traducirse al recuperarse, sin reencolar
archivos sanos previamente conocidos.

## Renombrado

Plantillas de película, serie y anime; clasificación editable, varios episodios,
preview/diff por fila, metadatos Jellyfin primero y TMDB como respaldo, siempre
con selección explícita si hay candidatos. Tokens: `{title}`, `{year}`, `{season}`,
`{episodes}`, `{absolute}`. Videos y sidecars se agrupan conservando idioma/forced/SDH.

Los planes duran 30 min y las revisiones sustituyen al anterior. Dry-run y ejecución
revalidan identidad, raíces y conflictos; SQLite guarda historial y deshacer por
lote, verificando que no se sobrescriban archivos ajenos.

Por defecto se renombra en la misma carpeta; mover a carpetas Season es opt-in.
Para garantizar no sobrescritura se usan hardlinks en el mismo volumen y unlink
verificado. Sistemas sin soporte, movimientos entre volúmenes, ciclos y destinos
solo distintos por mayúsculas se rechazan explícitamente: no hay fallback que
sobrescriba ni copie automáticamente videos enormes. Historial visible: últimas
1.000 operaciones de archivo.

## Despliegue

Solo el frontend publica puerto por defecto; usa `/api` hacia el servicio `api`.
Redis y API quedan en la red interna. `/health` refleja disponibilidad de Redis.
Para despliegues con otra topología, revisar el destino `API_INTERNAL_URL` al
construir/configurar Next: las rewrites se resuelven durante el build. Las imágenes
incluyen exclusiones de `.env`, datos, medios y dependencias del host.

`GET /system/preflight` informa datos/permisos, acceso a SQLite y migraciones
pendientes (sin ejecutarlas), Redis, clave de cifrado, qué proveedores tienen key
(sin valores), proveedor/modelo predeterminado y cada raíz permitida/seleccionada
con disponibilidad y permisos. Una raíz no montada se marca y no impide usar las
demás.
