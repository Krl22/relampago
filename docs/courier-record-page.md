# Ficha administrativa del motorizado

Ruta: `/couriers/:courierId`, protegida para administradores. En Lightning, el nombre del motorizado y «Abrir ficha del motorizado» llevan a esta página. Clásico sigue siendo el modo predeterminado y conserva sus entradas anteriores.

## Componentes y datos

La ficha utiliza `RecordHeader`, `MetricStrip`, `RecordTabs` y `RecordLayout`, compartidos con la ficha del comercio y el inventario. Incluye resumen, datos de cuenta, envíos, recojos, última ubicación reportada y actividad.

- Envíos consulta exclusivamente `assigned_courier = courierId`, con filtros, paginación y detalle de solo lectura. Reutiliza la lista y el detalle de pedidos de las fichas de comercios. Incluye registros actuales y finalizados; el comercio remitente enlaza a su ficha.
- Recojos consulta `pickup_assignments.courier_id`, incluyendo el recojo relacionado y su comercio. Se distingue la cantidad reportada por esta cuenta del total recibido por todo el recojo. Los filtros se aplican al estado y fecha programada del recojo.
- Ubicación consulta únicamente el último punto guardado para la cuenta; no solicita GPS del administrador ni modifica registros. Muestra fecha/hora de Lima y precisión reportada, y aclara que no confirma la presencia actual. El mapa se carga bajo demanda solo cuando hay un punto válido.
- Actividad muestra hasta 50 eventos de pedidos: acciones cuyo actor es el motorizado o asignaciones registradas a su nombre. La condición compuesta usa un UUID validado, nunca una expresión proporcionada por el usuario. No representa inicios de sesión ni cambios de perfil.

Las consultas utilizan la sesión del administrador. La ficha nunca inicia sesión como el motorizado; «Ver como» permanece como acción opcional separada, con la confirmación y auditoría existentes. No hay cambios de esquema ni de políticas de permisos.

## Navegación relacionada

En Inventario Global, los nombres de comercios enlazan a sus fichas para administradores en Lightning. Al volver se conservan el filtro de comercio de la URL y los filtros/orden del listado. Las fichas enlazadas desde un motorizado también permiten regresar a su ficha. Las rutas de retorno se validan como destinos internos conocidos y omiten `vista`, evitando anular una elección de apariencia posterior.

El listado de motorizados conserva sus filtros y orden al volver. La barra lateral mantiene Motorizados activo durante la consulta de una ficha.

## Verificación

- `node --test scripts/tests/courier-record.test.mjs scripts/tests/company-record.test.mjs scripts/tests/design.test.mjs`: consultas de solo lectura, alcance de asignación, validación de UUID/estados/fechas/paginación, retorno interno, filtros, Clásico por defecto y protección de las dos rutas de fichas para admin.
- `node supabase/tests/courier-record-access.test.mjs`: verificaciones en una transacción de solo lectura. Admin ve los registros esperados, conserva su identidad y no puede abrir perfiles administrativos como si fueran motorizados. El motorizado conserva acceso a su propia cuenta y el cliente no lee perfiles, recojos o GPS de otro usuario.
- Al ejecutar la prueba había una sola cuenta de motorizado y ningún pedido asignado. No se crearon cuentas ni datos de ejemplo. El caso entre dos motorizados distintos se ejecuta cuando existe una segunda cuenta; actualmente no se afirma haberlo ejercitado con datos reales.
- Compilación TypeScript/Vite y ESLint de los archivos nuevos y modificados. Los avisos previos de Stock se comparan con el respaldo, sin introducir nuevos.
- La revisión visual sigue pendiente mientras el navegador local esté deshabilitado en Work. Verificar HTTP/JS publicado no equivale a probar una sesión interactiva.

Respaldo previo: `work/checkpoints/courier-record-2026-11-06/src`. Worker anterior: `a5b670dc-f6a1-4981-829e-56255121dce1`.

## Publicación

Publicado el 6 de noviembre de 2026 en `https://relampago-courier.carthe5kboy.workers.dev`. Versión: `2ffb63bd-34d1-43db-a868-da46526b48eb`. Entrada: `index-Dlh1h4hA.js`.

La entrada publicada coincide con el build local. Los módulos de ficha de motorizado e inventario y las rutas SPA de motorizados, ficha e inventario responden HTTP 200. Esta comprobación confirma la entrega de archivos; la autorización se verificó por las pruebas de rutas y permisos, sin simular una sesión visual.
