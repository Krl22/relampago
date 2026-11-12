# Ficha administrativa del comercio

Ruta: `/comercios/:companyId`. En modo Lightning se abre pulsando el nombre del comercio o «Abrir ficha del comercio» en sus opciones. Solo está disponible para administradores; no requiere que el comercio tenga una cuenta del portal. El listado clásico conserva sus entradas anteriores para permitir presentar el cambio al dueño cuando active Lightning.

## Experiencia

La cabecera muestra nombre, RUC, distrito y prioridad. Los indicadores consultan cantidades exactas de pedidos activos, entregados, productos, recojos abiertos y liquidaciones pendientes de pago. Los datos no disponibles se distinguen de cero.

Las pestañas Resumen, Detalles, Pedidos, Inventario, Recojos, Liquidaciones, Direcciones, Accesos y Actividad mantienen el contexto del comercio. Cada sección se consulta cuando se visita por primera vez; las listas de pedidos, recojos y liquidaciones tienen filtros y paginación de 12 registros. Las pestañas admiten teclado y desplazamiento horizontal en pantallas pequeñas. Se utilizan tarjetas en celular/tablet y tablas en escritorio amplio.

El inventario reutiliza el espacio de stock aprobado, pasando el ID del comercio, con título administrativo y sin el botón de nuevo pedido del portal. Incluye productos, reservas, disponibilidad y movimientos. Las direcciones y cuentas se pueden gestionar mediante los diálogos administrativos existentes. «Ver como» queda como una acción opcional separada, no interviene en la consulta de datos.

El detalle de pedido permite consultar destinatario, dirección, motorizado, cantidades, importes, observaciones y evidencia. Actividad muestra los últimos 50 eventos de pedidos, con actor y hora de Lima cuando están registrados; no inventa auditoría del perfil del comercio. Las listas operativas completas conservan su paginación. Volver al listado restaura sus filtros y orden si se abrió la ficha desde allí.

## Seguridad y sesiones

No hay cambios de esquema, políticas ni privilegios. Todas las consultas usan la sesión administrativa actual y las políticas existentes. La ficha no solicita ni genera tokens de otro usuario. El ID se valida como UUID y cada lista relacionada agrega `company_id` antes de los filtros del usuario. Los estados permitidos son enumeraciones conocidas y las búsquedas se envían como valores, sin SQL libre ni condiciones OR interpoladas.

La selección de columnas del comercio omite `intake_token`; no consulta claves de IA, contraseñas ni notas personales. Cambiar de comercio remonta su contenido para descartar los resultados anteriores, y las respuestas tardías se ignoran al desmontarse. El menú mantiene Comercios activo en sus fichas tanto en Lightning como en la vista clásica.

## Verificación

- `node --test scripts/tests/company-record.test.mjs scripts/tests/design.test.mjs`: filtros, ámbito de comercio, parámetros inválidos, contexto del listado y ruta nueva protegida para admin. El resto de rutas y consultas anteriores conserva sus reglas.
- `node supabase/tests/company-record-access.test.mjs`: 19 comprobaciones con la conexión del proyecto, dentro de una transacción de solo lectura. Admin conserva su identidad de sesión y ve las filas esperadas; cliente no ve otro comercio en empresas, pedidos, stock, disponibilidad, movimientos, recojos, liquidaciones y direcciones. Se verifica `security_invoker=true` en la disponibilidad.
- Compilación TypeScript/Vite y ESLint de los archivos afectados.
- La comprobación visual en navegador está pendiente mientras el navegador local de Work permanezca deshabilitado. Las pruebas HTTP del despliegue verifican entrega de assets, no una sesión interactiva completa.

El respaldo previo está en `work/checkpoints/company-record-2026-11-06/src`; incluye todos los cambios de diseño y funcionalidad anteriores. La versión previa del Worker era `e6dc4829-5b11-4f08-8fa2-3b12693bf560`.

Publicado con la biblioteca compartida de componentes y Clásico como modo inicial: Worker `a5b670dc-f6a1-4981-829e-56255121dce1`, bundle `index-SZiCnSV7.js`. Compilación y ESLint correctos; 15 pruebas de aplicación y 19 verificaciones de permisos en transacción de solo lectura completadas. Se verificó la entrega del nuevo bundle en cuatro entradas públicas; la interacción con una sesión real en navegador sigue pendiente.
