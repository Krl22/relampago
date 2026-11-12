# Comercios, inventario y reparto

Las tablas administrativas de comercios, pedidos, motorizados, stock, recojos y liquidaciones usan `RowActions`: el clic derecho y el botón de tres puntos comparten las mismas acciones. Los menús admiten teclado, toque y reposicionamiento al borde de la pantalla. Las confirmaciones de acciones destructivas se mantienen en cada página.

La prioridad de un comercio se deriva de tener al menos un producto registrado en `stock`, incluso si su cantidad llega a cero. La base sincroniza `companies.skip_cutoff` al registrar, trasladar o eliminar productos. Quitar el último producto desactiva la prioridad. No se configura en el formulario de comercios. Los pedidos ya programados conservan su fecha.

Administración y reparto usan identidades independientes: solo `profiles.role = 'courier'` recibe nuevas asignaciones de pedidos/recojos y publica ubicaciones. `is_courier` se mantiene por compatibilidad, derivado exclusivamente del rol. No se convierten administradores ni se crean cuentas automáticamente: el formulario Nuevo motorizado requiere otro correo y crea una identidad nueva mediante `admin-users/create_courier`, validando la sesión administrativa en el servidor.

El formulario de comercios limita su altura al viewport, permite desplazar los campos y conserva el pie con Guardar/Cancelar visible. Los diálogos compartidos también tienen un límite de altura.

## Verificación

El menú de comercios incluye «Ver como» solo para administradores. Abre un selector de cuentas: únicamente las activas y vinculadas al comercio permiten entrar. Si falta una cuenta, ofrece gestionar accesos. El servidor vuelve a comprobar el comercio y exige registrar la entrada en `impersonation_log`; se mantienen la confirmación y la opción de volver a la cuenta administrativa.

Para pedidos con origen Almacén, el motorizado confirma el retiro de los paquetes antes de iniciar ruta. El cambio a `picked_up` queda en `order_events` con actor y ubicación reciente, si existe. Para origen Recojo, primero se completa el conteo del recojo del comercio. Sus entregas se habilitan cuando el recojo queda completo; los recojos parciales siguen pendientes. El mapa excluye entregas que aún no están recogidas y muestra enlaces para completar ese paso. No se inventa una ubicación del almacén.

La base valida el orden de estados del motorizado incluso si se salta la interfaz. Central conserva sus permisos de corrección. El modelo de reservas y descuento de stock al entregar no cambia.

`npm run build`

`node supabase/tests/operations-rules.test.mjs`

`node supabase/tests/courier-fulfillment.test.mjs`

Las pruebas de reglas usan la conexión del proyecto, ejercitan prioridad, movimientos de productos, asignaciones y permisos, y revierten todos sus cambios al finalizar. No crean cuentas de Auth ni envían correos.
