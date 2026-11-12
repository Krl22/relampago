# Lightning en Relámpago

## Dirección y alcance

Se extiende el modelo aprobado de Mi stock a administración, comercios, reparto y páginas públicas. Se mantiene la tipografía del sistema. Los títulos son de 20–24 px, el contenido de 14 px y los datos de tabla de 13 px.

## Paleta "Menta" y modo oscuro (noviembre 2026)

Inspirada en la mascota de Relámpago (fondo menta, cuerpo turquesa, casaca azul rey de la empresa y el dorado del logo). Todo vive en `src/lightning.css` como variables `--lx-*` y en los tokens de Tailwind, en dos temas:

| | Menta de día (claro) | Menta de noche (oscuro) |
|---|---|---|
| Fondo | `#edf5f1` | `#0b1614` |
| Tarjetas | `#ffffff` | `#11201d` |
| Texto | `#13302b` | `#e3f0eb` |
| Texto secundario | `#52706a` | `#93b0a8` |
| Principal (casaca) | `#1238d0` | `#7f9bff` (texto azul noche encima) |
| Turquesa | `#1d7a66` | `#5ccfb0` |
| Logo | rayo dorado `#f5b82e` sobre azul casaca | igual |

Todos los textos cumplen contraste WCAG AA (≥ 4.5:1) en ambos temas. Las cabeceras de página llevan una línea azul casaca → turquesa.

- **Selector de tema**: claro / oscuro / según el equipo, en la barra superior de Lightning (en celular, un solo botón que rota). Se guarda en `relampago.theme.v1`; por defecto sigue al equipo. `index.html` aplica vista y tema antes de pintar para evitar el destello blanco.
- **Solo Lightning**: el atributo `data-theme` existe únicamente con `data-design="lightning"`; la vista clásica no cambia.
- **Colores fijos de los componentes** (`bg-white`, `text-slate-500`, `bg-green-100`…): se traducen al tema desde un bloque generado al final de `lightning.css`. Si se agregan clases de color nuevas, regenerarlo con `node scripts/lightning-dark-utilities.mjs`.
- **Mapas** en oscuro: se oscurecen los mosaicos, no los marcadores ni las zonas.
- Revisado con un chequeo automático de contraste en todas las pantallas de comercio (Mis pedidos, Nuevo pedido, Carga masiva, Mi stock, Mis liquidaciones, Mi comercio, Tarifario) y de motorizado (Mis envíos, Mis recojos, Mi ruta), en ambos temas, escritorio y celular.

La composición sigue una página de trabajo: navegación por módulos, cabecera con contexto y acciones, componentes de datos y formularios. No incorpora el framework de Salesforce ni cambia los datos o la autorización. Se revisó el diseño para conservar la identidad de Relámpago y evitar cambios de navegación innecesarios.

```text
Escritorio
┌ Navegación ┬ Contexto de la página ─────── Vista anterior ┐
│ Operación │ Título / acciones                            │
│ Gestión   │ Filtros · componentes · tablas / formularios │
│ Consulta  │                                              │
│ Cuenta    │                                              │
└───────────┴──────────────────────────────────────────────┘
Celular / tablet
┌ Menú · página ────────────────────────── Vista anterior ┐
│ Cabecera y acciones ajustadas al ancho                  │
│ Componentes en una columna / tarjetas del comercio     │
└───────────────────────────────────────────────────────┘
```

## Experiencia por rol

- Administración y staff: navegación agrupada, cabeceras consistentes, acciones por fila, tablas contenidas con desplazamiento por teclado y sin ensanchar toda la página. El inventario global y el asistente se muestran exclusivamente a admin en el menú, igual que antes.
- Comercio: Mi stock conserva sus pestañas. Mis pedidos y Mis liquidaciones añaden tarjetas para celular; incluyen importes, estados y acceso a evidencia o detalle. Las tablas se mantienen desde tablet y en la vista clásica.
- Motorizado: se conservan las tarjetas, la confirmación de retiro, la ruta y las acciones operativas. Se amplían controles táctiles y se ordena su navegación de reparto.
- Acceso, activación, formulario público, cobertura y mapa a pantalla completa también permiten cambiar de vista.

El menú móvil usa un diálogo accesible con foco contenido, cierre con Escape y retorno al botón que lo abrió. Las transiciones respetan movimiento reducido. Las tablas amplias permiten desplazamiento interno; los formularios ajustan los campos y los diálogos al viewport. La impresión oculta los controles correspondientes.

## Vista anterior

`DesignProvider` controla la apariencia en toda la app. El modo predeterminado es **Clásico**. Esta actualización inicia una nueva preferencia `relampago.design.v2`, que ignora la preferencia de prueba anterior para que nadie reciba Lightning automáticamente. Tras una elección explícita, se recuerda la vista en este navegador; no contiene datos de cuenta. El parámetro `vista=clasica` o `vista=lightning` permite abrir y compartir una vista explícita. Cambiarla conserva los demás parámetros y el fragmento de la URL.

El shell y su Outlet son los mismos en ambos modos: cambiar de vista conserva el componente de página y sus campos sin guardar. La pantalla de stock alterna entre dos representaciones de solo lectura. Las páginas públicas ofrecen el control arriba; la clásica también lo incluye en su menú lateral.

La hoja `src/lightning.css` está completamente acotada a `data-design="lightning"`; la vista clásica recupera los estilos originales y su navegación azul. Los atributos añadidos a páginas y componentes no alteran las consultas.

## Carga y errores

Las pantallas se cargan por separado con React.lazy. El espacio conserva su navegación mientras carga una página. Un fallo de descarga ofrece volver a cargar, en lugar de mostrar una pantalla vacía. La caché inicial de la PWA incluye el grafo de dependencias de arranque y login; las pantallas y mapas se guardan al visitarlos. Solo se cachean archivos públicos compilados y los tiles existentes; Supabase continúa como NetworkOnly.

## Respaldo y restauración

Antes del cambio se copió `src` a `work/checkpoints/lightning-app-2026-11-06/src` y la configuración de Vite a ese mismo checkpoint. La versión del Worker anterior era `6dd11a2c-a4cf-4508-b64e-c14c49df2bca`. El checkpoint conserva el prototipo de Mi stock ya aprobado y todos los cambios funcionales anteriores.

Una restauración completa debe copiar únicamente los archivos modificados por este rediseño desde el checkpoint y retirar sus archivos nuevos, conservando cualquier trabajo posterior. Para comparar normalmente basta con el botón de vista, sin restaurar archivos ni desplegar.

## Verificación y límites

Publicado el 6 de noviembre de 2026. Worker: `e6dc4829-5b11-4f08-8fa2-3b12693bf560`. Bundle de entrada: `index-CIf4a6in.js`. Caché inicial verificada: 25 archivos, 672.72 KiB, con núcleo y login; Excel, Dashboard, comercios y la librería del mapa quedan fuera de la descarga inicial.

- Compilación TypeScript/Vite y ESLint de los componentes del diseño y de las páginas con representaciones móviles nuevas.
- `node --test scripts/tests/design.test.mjs`: preferencia, parámetros de URL, cambio externo, almacenamiento bloqueado, roles, autorización de rutas, aislamiento CSS y consultas originales de las 21 páginas.
- Confirmación del HTML y assets publicados después de desplegar.
- La revisión visual no pudo realizarse: Computer Use informó que el navegador local está deshabilitado en los ajustes de Work. Queda pendiente comprobar geometría, comodidad e interacciones reales en escritorio, tablet y celular. No se afirma haber validado dispositivos físicos ni todos los flujos de producción.
