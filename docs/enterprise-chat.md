# Asistente empresarial y Telegram de Relámpago

## Estado publicado

La web está publicada en https://relampago-courier.carthe5kboy.workers.dev/asistente. La ruta requiere iniciar sesión con un perfil de administrador. El menú y los recordatorios también son exclusivos de administradores. Al conectar una clave válida, el diálogo se cierra y se seleccionan automáticamente el proveedor y su catálogo verificado, sin recargar ni perder la conversación. No se hace una segunda petición para habilitar el modelo y las respuestas antiguas de otro catálogo no pueden sobrescribir la selección nueva. Están aplicadas las migraciones del asistente, desplegadas las funciones `enterprise-chat`, `telegram-webhook` y `telegram-worker`, configurados los secretos de infraestructura y activo el programador de recordatorios cada minuto. La comprobación real del programador devolvió HTTP 200.

En las verificaciones de desarrollo no se usaron claves reales de OpenAI/Claude/DeepSeek/OpenRouter ni se enviaron mensajes al bot personal. Para empezar, cada administrador conecta sus propias claves desde la web. Nunca deben compartirse en este chat.

## Acceso exclusivamente de lectura

Por instrucción del usuario, todas las herramientas del modelo son de lectura. Para cualquier cuenta autorizada:

- `list_orders`: consulta hasta 50 pedidos permitidos y devuelve el total exacto y un indicador de truncamiento.
- `order_summary`: conteos exactos por estado en un intervalo máximo de 31 fechas de calendario.
- `list_notes`: lee hasta 20 notas pendientes del propietario; hasta 1.000 caracteres por nota e indicadores de truncamiento.
- `create_report`: exporta datos autorizados a Excel, Word o PDF. Solo escribe el archivo y su registro de entrega; no modifica operaciones de la empresa.

Para administradores se añaden `find_users` y `user_activity`. Identifican cuentas por nombre/rol y leen los eventos existentes de pedidos. Las fechas se filtran por `created_at` del evento en Lima, no por fecha programada. Sin fechas, consultan los eventos más recientes de todo el historial. El resultado incluye la cobertura real: solo creación de pedidos, cambios de estado y asignación. No identifica automáticamente al dueño, no registra sesiones ni todas las ediciones y un resultado vacío no prueba inactividad. Comercios y motorizados no reciben esas herramientas; además se deniega su ejecución en el backend y en SQL. Las funciones son `SECURITY INVOKER` y evitan que el cliente suplante al usuario consultante.

No puede crear, modificar o eliminar pedidos, clientes, inventario o notas. No puede ejecutar SQL libre, escoger tablas/columnas arbitrarias, proporcionar URLs externas ni ejecutar herramientas de escritura. La prueba de solo lectura comprueba que esas operaciones se rechazan antes de acceder a la base.

Las escrituras internas son el historial del chat, los archivos exportados, la configuración elegida expresamente por el usuario, la vinculación de Telegram y las colas/registros de entrega. El formulario de notas de la web sigue siendo una acción manual del usuario, separada de las herramientas del modelo. El bot no crea notas ni programa recordatorios por lenguaje natural.

## Reportes y descargas

Se pueden pedir archivos reales con frases como «Genera un Excel de los pedidos del 1 al 4 de noviembre de 2026», «Dame mis notas pendientes en Word» o «Exporta en PDF la actividad registrada de este usuario». Los datos salen de una consulta fija, completa y autorizada; nunca se exporta la muestra resumida del chat como si fuera el conjunto total. Las tablas también pueden mostrarse como texto en las respuestas.

- Formatos: `.xlsx` con filtros, encabezados y total del servicio; `.docx` editable con tabla; `.pdf` paginado con encabezados repetidos. Fechas en hora de Lima. Importe del servicio y dinero cobrado se muestran como conceptos separados.
- Datos disponibles: pedidos por fecha programada y estado, notas personales pendientes por fecha de creación y actividad registrada de pedidos para administradores. La actividad conserva la cobertura parcial descrita arriba.
- Límites: 2.000 filas en Excel, 500 en Word/PDF, 250.000 caracteres de datos y tres archivos por consulta. Pedidos requieren un rango de hasta 366 fechas. Si excede el límite se pide reducir filtros, sin entregar un reporte incompleto.
- Web: el mensaje muestra una tarjeta con **Descargar XLSX/DOCX/PDF**. Cada clic vuelve a verificar sesión, propietario y alcance; obtiene un enlace privado de 60 segundos y descarga el archivo al dispositivo.
- Telegram: la cola envía el archivo como documento adjunto al chat privado vinculado; se puede guardar en el dispositivo. Vuelve a comprobar permisos y vigencia antes de enviarlo. El archivo ya descargado o recibido en Telegram permanece en el dispositivo del usuario.
- Los originales se guardan 24 horas en el bucket privado `enterprise-chat-reports`; las descargas de otra cuenta, el cambio de rol/empresa, la pérdida de acceso a cualquiera de los registros y la eliminación de la conversación impiden nuevas descargas. La limpieza periódica elimina archivos vencidos y huérfanos. El modelo solo recibe metadatos, nunca URLs de Storage.
- El backend usa renderizadores de formato con campos validados. No ejecuta código, SQL, HTML o fórmulas proporcionados por el modelo. En Excel los valores del usuario se escriben como texto literal para impedir inyección de fórmulas.

No requiere otra clave para generar archivos: utiliza la IA ya vinculada para interpretar la solicitud y el backend para crear el documento. Aplican el consumo habitual del proveedor y del alojamiento/almacenamiento.

## OpenRouter y Mi consumo

En **Configuración → OpenRouter** se puede conectar una clave propia de inferencia. El backend comprueba la clave con `/api/v1/key` antes de guardar su cifrado, porque el catálogo de modelos es público. Rechaza claves de administración y solo ofrece modelos de texto cuyo catálogo declara soporte de herramientas. Las llamadas van al endpoint fijo de OpenRouter, con `require_parameters` para que el proveedor seleccionado respete las herramientas. Mantiene los límites de cuatro pasos y seis herramientas y los permisos de lectura. Los modelos disponibles y su acceso pueden variar según la cuenta del proveedor. Para Telegram, elegir el modelo en la web y pulsar **Telegram → Usar selección del chat web**.

El botón **Mi consumo**, junto a Telegram y Configuración, muestra exclusivamente el uso de la cuenta actual:

- Filtros por fechas de Lima, proveedor y conversación; intervalo inicial de 30 días y máximo de 366 fechas.
- Tokens de entrada y salida, detalle de caché y razonamiento sin sumarlos dos veces; consultas y llamadas intermedias al modelo.
- Costo reportado por OpenRouter, separado del estimado para conexiones directas. El costo reportado corresponde a `usage.cost`, no al saldo global ni a las recargas; BYOK configurado dentro de OpenRouter puede tener facturación adicional del proveedor.
- Estimaciones con tarifas estándar verificadas el 4 de noviembre de 2026 para IDs exactos documentados de OpenAI, Claude y DeepSeek. Las tarifas tienen una vigencia interna de 30 días y deben revisarse antes de renovar `chat_model_prices`. Modelos sin tarifa, contextos fuera del límite y consumos sin medición quedan como **no disponibles**, nunca como gratuitos. DeepSeek usa una estimación conservadora de hora punta y lo indica en cada llamada; descuentos, festivos y horario pueden reducir el cargo.
- Resumen completo del intervalo, hasta 100 modelos, 50 conversaciones recientes y 30 llamadas recientes con canal web/Telegram. Las tablas indican sus límites; los totales no dependen de estas muestras.
- Registro desde esta actualización. No reconstruye tokens o dinero de mensajes antiguos. Borrar una conversación conserva el consumo sin su texto o título original. No muestra consumos de otras aplicaciones que utilicen la misma clave.

Cada llamada de generación se reserva en `chat_usage_calls` **antes** de contactar al proveedor. Si el registro no se puede crear, no inicia esa llamada de pago. Después se guardan las mediciones antes de validar el texto o ejecutar herramientas: una respuesta truncada también conserva su consumo. Caídas, timeouts y respuestas sin datos quedan marcados como incompletos. El reenvío de una solicitud ya completada recupera su respuesta sin generar ni contar otra llamada. No se reintenta automáticamente una llamada de pago. El registro no contiene claves, mensajes, resultados de herramientas ni respuestas completas del proveedor.

El panel usa una consulta agregada fija `SECURITY INVOKER`, con la sesión del usuario y RLS. No recibe un ID de propietario enviado por el cliente. Solo el backend puede escribir mediciones y consultar o modificar tarifas. Esta función no añade herramientas de escritura al modelo.

## Cómo usarlo

1. Abrir **Asistente IA → Configuración** y conectar una clave propia de OpenAI, Anthropic, DeepSeek u OpenRouter. Se verifica el acceso y se guarda cifrada.
2. Elegir proveedor y modelo en el chat. El catálogo se consulta al proveedor, sin inventar IDs de modelos. Al cambiar de proveedor se comparte el contexto reciente con el proveedor elegido.
3. Para Telegram, crear un bot con [BotFather](https://t.me/BotFather), mediante `/newbot`.
4. Abrir **Asistente IA → Telegram**, introducir su token y pulsar **Conectar bot**. El campo se limpia y el token no vuelve a mostrarse.
5. Generar el enlace de vinculación, abrirlo en Telegram y pulsar Iniciar. El bot envía un código de seis dígitos. Confirmarlo en la web dentro de los diez minutos del enlace. Hay un máximo de cinco intentos; el enlace por sí solo no concede acceso.
Si Telegram no conserva el enlace, la web muestra el mensaje completo `/start <desafío>` para copiarlo al bot. Un `/start` sin desafío recibe instrucciones genéricas de vinculación; nunca vincula automáticamente la identidad ni revela datos de la cuenta. Estas instrucciones se limitan a una entrega por bot/chat/minuto y no consumen IA. La web muestra el último estado de recepción —sin almacenar texto, enlace ni código en esos metadatos— y distingue enlace vencido, solicitud en cola y `/start` incompleto.
6. Pulsar **Usar selección del chat web** para compartir el modelo y la conversación activos. Si no se seleccionó una conversación, se conserva o crea una específica para Telegram.
7. Activar **Recordatorios por Telegram** para recibir las notas con fecha cuando venzan, con la web cerrada. Cada aviso es de una sola vez; no hay recordatorios recurrentes. Los avisos no llaman al proveedor de IA.

Telegram admite chats privados con la identidad vinculada. Rechaza grupos, otros remitentes y mensajes anteriores a la vinculación. Comandos: `/help`, `/modelo` y `/nuevo`; este último solo crea una conversación interna, no cambia datos empresariales. La configuración permite desconectar el bot y detener sus avisos conservando conversaciones y notas.

Si un bot ya está conectado a otra aplicación, la web rechaza tomar su webhook. Hay que usar otro bot o desconectarlo primero de la aplicación anterior.

## Seguridad y permisos

- La web valida la sesión con Supabase Auth y vuelve a leer el perfil; rechaza cuentas anónimas, pendientes de activación y cualquier rol distinto de admin, incluidos staff, comercios y motorizados. Las políticas restrictivas de las tablas de chat y las funciones SQL también verifican el rol actual, conservando la privacidad por propietario.
- Conversaciones, notas y archivos son privados por cuenta, incluidos administradores. RLS se aplica a las once tablas nuevas. Las claves, cuentas de Telegram y colas no tienen acceso directo para `anon` o `authenticated`.
- La web consulta datos con el JWT del usuario y RLS. Telegram no tiene una sesión web: primero verifica su secreto por bot y la identidad enlazada. El servidor vuelve a comprobar la cuenta, su estado de acceso, rol y empresa antes de cada herramienta.
- Para Telegram se utilizan filtros explícitos de empresa/asignación y una función fija de resumen, exclusiva de backend. El parámetro de propietario nunca procede de Telegram ni del modelo. Todas las funciones SQL nuevas son `SECURITY INVOKER`; no se crean funciones de suplantación accesibles a usuarios.
- Actualmente solo los administradores pueden consultar el asistente; los demás roles quedan bloqueados también en Telegram, descargas y llamadas directas. Las conversaciones y claves anteriores se conservan. No se envían teléfonos, DNI ni direcciones mediante estas herramientas.
- Claves de IA y token de Telegram: AES-256-GCM con nonce aleatorio y autenticación de propietario/proveedor. Solo existen momentáneamente en el formulario y el POST autenticado antes de cifrarse; no se guardan en almacenamiento del navegador, URLs de la web ni historial. Los secretos de infraestructura no están en Git ni variables `VITE_*`.
- El webhook valida un secreto aleatorio diferente por bot. La vinculación guarda hashes de los desafíos y exige confirmación desde la sesión web. Los códigos vencidos no autorizan acceso.
- Telegram necesita su token en la URL de su API oficial. Por eso las excepciones de red y respuestas de error se sustituyen por mensajes seguros; no se registran URLs, tokens, prompts ni resultados privados.
- CORS limita los orígenes permitidos. Las respuestas del endpoint tienen `Cache-Control: no-store`. La verificación JWT permanece activa en `enterprise-chat`; webhook y worker tienen autenticación propia y JWT de plataforma desactivado de forma explícita.
- «Ver como» conserva la política existente del proyecto: quien pueda obtener legítimamente una sesión de otra cuenta hereda sus permisos. El token de IA/Telegram sigue sin devolverse al navegador.

## Procesamiento y límites

La web y Telegram comparten el motor `runTurn`, los adaptadores, las herramientas y el historial. El turno se coordina en Postgres: una consulta activa por usuario y seis consultas nuevas por minuto, incluso entre web y Telegram. Los IDs de solicitud permiten reutilizar una respuesta ya completada sin otra llamada de IA.

Las consultas tienen hasta 8.000 caracteres; el contexto reciente, hasta 20 mensajes y 32.000 caracteres; la salida, hasta 2.048 tokens y 24.000 caracteres. La generación admite hasta cuatro pasos y seis llamadas a herramientas. Los mensajes anteriores se conservan y se cargan por páginas. La interfaz lista las 100 conversaciones recientes y hasta 100 notas pendientes.

El webhook guarda los mensajes en una cola con una restricción única por cuenta/bot/update de Telegram y responde inmediatamente. El procesamiento en segundo plano y el programador usan reclamaciones atómicas con `SKIP LOCKED`; los trabajos abandonados tienen una reserva con vencimiento. No se reintenta a ciegas una generación de pago.

Las respuestas y los recordatorios salen de una cola persistente, con fragmentos de hasta 3.500 unidades de texto sin cortar pares Unicode. Los límites 429 de Telegram se reprograman. Si una entrega queda sin confirmación por timeout o caída, se marca como incierta y no se reenvía automáticamente para evitar duplicados. Una cancelación de nota o desconexión se vuelve a comprobar antes de enviar. La configuración muestra los errores de entrega.

El programador se ejecuta cada minuto mediante Supabase `pg_cron` y `pg_net`. El secreto específico del worker está en Vault y el comando cron solo contiene su nombre. `net` no está expuesto por la Data API —verificado con respuesta 406—. Como documenta Supabase, operadores con acceso SQL a la base podrían ver encabezados mientras están en la cola interna; no se debe dar acceso SQL directo a usuarios de la aplicación. El secreto del worker permite procesar colas, no consultar ni modificar datos arbitrarios.

## Archivos principales

| Área | Archivos |
| --- | --- |
| Ruta y navegación | `src/App.tsx`, `src/components/AppLayout.tsx` |
| Chat web y configuración | `src/pages/EnterpriseChat.tsx`, `src/components/chat/ChatSettings.tsx`, `ChatNotes.tsx`, `ChatReminder.tsx`, `TelegramSettings.tsx` |
| Cliente autenticado | `src/lib/enterpriseChat.ts` |
| API y motor compartido | `supabase/functions/enterprise-chat/handler.ts`, `engine.ts`, `validation.ts` |
| IA, cifrado y consultas | `providers.ts`, `crypto.ts`, `tools.ts` dentro de `enterprise-chat` |
| Telegram | `telegram-api.ts`, `telegram-settings.ts`, `telegram-webhook.ts`, `telegram-worker.ts` dentro de `enterprise-chat` |
| Reportes | `reports.ts`, `report-model.ts`, `report-render.ts`, `report-font.ts`, `FONT-LICENSE.txt` dentro de `enterprise-chat`; `src/components/chat/ReportAttachment.tsx` |
| Consumo | `supabase/functions/enterprise-chat/usage.ts`, `usage_test.ts`; `src/components/chat/ChatUsage.tsx`; `supabase/migrations/20261104171000_openrouter_usage.sql` |
| Entradas desplegadas | `supabase/functions/enterprise-chat/index.ts`, `supabase/functions/telegram-webhook/index.ts`, `supabase/functions/telegram-worker/index.ts` |
| Migraciones aplicadas | `supabase/migrations/20261104041141_enterprise_chatbot.sql`, `20261104044051_telegram_assistant.sql`, `20261104053648_assistant_readonly_user_activity.sql`, `20261104054538_telegram_link_feedback.sql`, `20261104060947_assistant_report_files.sql`, `20261104071900_deepseek_provider.sql`, `20261104171000_openrouter_usage.sql` |
| Programador | `supabase/ops/telegram-cron.sql` |
| Configuración y pruebas | `supabase/config.toml`, `supabase/deno.json`, `supabase/deno.lock`, `supabase/functions/enterprise-chat/chat_test.ts`, `telegram_test.ts`, `usage_test.ts`, `supabase/tests/enterprise_chat_test.ts` |

Se conservaron los cambios locales anteriores del proyecto. No se regeneró `src/types/database.ts`, que tenía cambios previos: el navegador usa contratos tipados del endpoint.

## Comprobaciones realizadas

- Compilación de TypeScript y Vite; lint de archivos nuevos/modificados del asistente; comprobación de tipos de las tres funciones.
- 27 pruebas de backend y Postgres aislado: cifrado, permisos, herramientas de lectura, rechazos de escritura, historial, repetición de solicitudes, vinculación con código, webhook, colas, vencimientos, recordatorios y reportes. Incluyen archivos completos de 80 filas, formatos reales, descarga por propietario, cambio de alcance y envío multipart de documentos.
- Generación de Excel, Word y PDF en el servidor real con 80 registros sintéticos: subida privada, descarga autorizada, enlace temporal y bloqueo de acceso anónimo. Archivos de prueba eliminados al terminar. PDF y Word renderizados e inspeccionados visualmente.
- Regresión de navegador de los tres botones de descarga: nombre y contenido exactos, archivos vencidos deshabilitados, rechazo por permisos, diseño móvil y ausencia de errores JavaScript. Sin usar datos de clientes ni llamadas de IA de pago.
- 12 comprobaciones adicionales de regresión BYOK: cierre automático, selección de Claude desde OpenAI, envío inmediato, reemplazo, errores, desconexión, conservación del historial y rechazo de una respuesta tardía del proveedor anterior. Sin recargar la página ni llamadas reales de IA.
- La misma regresión pasó para DeepSeek en la web publicada, incluida la elección automática tras guardar, catálogo verificado, reemplazo y ausencia de claves en almacenamiento del navegador. Además se comprobó que **Usar selección del chat web** envía proveedor y modelo DeepSeek a la configuración de Telegram. Las llamadas a IA/Telegram se simularon; no se consumió saldo del usuario.
- OpenRouter: regresión de conexión y selección para Telegram; pruebas del panel Mi consumo con filtros de fecha/proveedor/conversación, error y reintento, importes faltantes, intervalo vacío y escritorio/móvil. Se verificó la acumulación de pasos intermedios, normalización de caché/razonamiento, costo cero informado frente a costo desconocido, reserva antes de facturar y conservación del uso de respuestas truncadas. Una prueba adicional en la base real confirmó aislamiento entre dos cuentas y denegación de cambios a las mediciones; todos sus registros se revirtieron.
- 17 comprobaciones de navegador sobre la web publicada con Supabase/IA/Telegram simulados: configuración de claves, limpieza de campos y almacenamiento, conversación, cambio a Claude con historial, notas, avisos, móvil, conexión/confirmación/modelo/avisos/desconexión de Telegram. Sin errores JavaScript sin capturar.
- En producción: llamadas anónimas rechazadas con 401; worker autorizado responde 200; preflight del navegador responde 204; once tablas con RLS; tablas sensibles inaccesibles al cliente; esquema `net` fuera de la Data API.
- Prueba de aislamiento en la base real con dos identidades, en una transacción revertida: lectura propia permitida, lectura/eliminación ajenas bloqueadas y tablas de backend denegadas. No dejó filas de prueba.
- Ejecuciones reales del programador y respuestas HTTP 200 del worker, con colas vacías.

El lint general conserva errores anteriores en otros componentes del proyecto. La compilación conserva avisos anteriores de tamaño de paquetes y configuración de Vite.

Pruebas reproducibles:

```powershell
npm run build
npx deno task --config supabase/deno.json check:chat
npx deno task --config supabase/deno.json test:chat
npx eslint src/pages/EnterpriseChat.tsx src/components/chat src/lib/enterpriseChat.ts supabase/functions/enterprise-chat supabase/functions/telegram-webhook supabase/functions/telegram-worker supabase/tests/enterprise_chat_test.ts
```

## Administración y pendientes

Los secretos configurados son `CHATBOT_ENCRYPTION_KEY`, `CHATBOT_WORKER_SECRET` y `CHATBOT_ALLOWED_ORIGINS`. Supabase suministra sus propias variables de conexión. Mantener una copia segura del secreto de cifrado: no cambiarlo sin recifrar las claves existentes. El archivo de provisión local está fuera de las carpetas de funciones y no se entregó como documento público.

La activación individual requiere claves propias y un bot creado por el usuario. La prueba final de generación real con OpenAI/Claude/DeepSeek/OpenRouter y recepción real en Telegram queda pendiente de esas credenciales; no se inventaron ni se usaron claves reales de terceros.

DeepSeek está habilitado en web y Telegram mediante un adaptador propio: endpoints fijos oficiales `/models` y `/chat/completions`, modelos descubiertos con la clave del usuario, llamadas a herramientas validadas, respuestas de texto y reportes. Se usa el modo sin pensamiento para mantener la respuesta dentro del presupuesto actual del chat; cualquier estado transitorio de herramientas se conserva únicamente durante el turno, sin mostrarse como respuesta. Los límites de cuatro pasos/seis herramientas, acceso de lectura, historial compartido y manejo seguro de errores se conservan. La migración `20261104071900_deepseek_provider.sql` amplía las restricciones de proveedor de claves, turnos y cuentas de Telegram sin cambiar datos empresariales ni claves existentes. El diálogo se cierra automáticamente al guardar y se selecciona DeepSeek sin recargar. Para usarlo en el bot hay que pulsar **Telegram → Usar selección del chat web**.

Qwen y Kimi siguen previstos como conexiones directas mediante nuevos adaptadores y pruebas específicas; si aparecen modelos compatibles en OpenRouter, pueden seleccionarse a través de esa conexión. No hay herramientas de escritura del modelo, recordatorios recurrentes ni envío por WhatsApp/correo. Cualquier ampliación debe conservar el acceso de lectura solicitado.

Fuentes oficiales: [Telegram Bot API](https://core.telegram.org/bots/api), [vinculación de Telegram](https://core.telegram.org/bots/features#deep-linking), [Supabase: programar funciones](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase: RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [OpenAI: herramientas](https://developers.openai.com/api/docs/guides/function-calling), [Claude: Messages](https://platform.claude.com/docs/en/api/messages/create), [DeepSeek: catálogo de modelos](https://api-docs.deepseek.com/api/list-models/), [DeepSeek: herramientas](https://api-docs.deepseek.com/guides/tool_calls/), [DeepSeek: modo de pensamiento](https://api-docs.deepseek.com/guides/thinking_mode/).

Fuentes de consumo: [OpenRouter: uso y costo por respuesta](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [OpenRouter: catálogo](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), [OpenAI: tarifas](https://developers.openai.com/api/docs/pricing), [Claude: tarifas](https://platform.claude.com/docs/en/about-claude/pricing), [DeepSeek: tarifas y horarios](https://api-docs.deepseek.com/quick_start/pricing/).
