# Propuesta de Mi stock

Este documento describe el primer modelo aprobado. El estilo y el selector de vista se extendieron después a toda la aplicación; el control se encuentra ahora en la cabecera o el menú global. Ver `docs/lightning-app-design.md` para el estado actual.

## Alcance y dirección

Solo cambia la pantalla del comercio `/my-stock`. El resto del portal conserva su diseño. Se inspira en las páginas de objetos de Lightning: cabecera, resumen de datos, pestañas y componentes relacionados, usando los componentes React actuales de Relámpago.

Paleta: azul de acción `#0b5cab`, blanco `#ffffff`, cabecera gris `#f3f3f3`, bordes gris pizarra y texto gris oscuro. Se conserva la tipografía de la aplicación, con títulos de 20–24 px, contenido de 14 px y datos numéricos tabulares. El color comunica disponibilidad, junto al valor y su etiqueta.

En escritorio amplio:

```text
┌ Mi stock · Almacén de Relámpago ─ Actualizar · Nuevo pedido ┐
│ Productos · En almacén · Comprometido · Disponible           │
├───────────────────────────────────┬─────────────────────────┤
│ Inventario | Movimientos          │ Actividad reciente      │
│ Buscar · filtros · orden          │ Cuatro movimientos      │
│ Lista y paginación                │ Ver movimientos         │
│                                   │ Cómo se calcula         │
└───────────────────────────────────┴─────────────────────────┘
```

Se revisó la propuesta para que las pestañas sean el acceso principal a los movimientos, incluso cuando no cabe el panel lateral. No se añaden gráficos decorativos ni se repiten las cantidades en varias tarjetas.

## Adaptación

- Menos de 768 px: inventario y movimientos se muestran como tarjetas, sin exigir deslizar tablas horizontalmente. Los botones y filtros táctiles miden al menos 44 px; las pestañas, 48 px.
- Desde 768 px: tablas compactas; la página sigue en una columna cuando no cabe el panel relacionado.
- Desde 1280 px: panel lateral de actividad y explicación. La pestaña Movimientos sigue disponible arriba.
- Los cuatro datos de cabecera se distribuyen en dos columnas en celular y cuatro desde 640 px. Los controles y acciones permiten salto de línea.
- Pestañas con roles accesibles, flechas izquierda/derecha, Inicio/Fin y foco visible. Búsquedas y selectores tienen nombre accesible.
- Las pestañas se mantienen fijas al recorrer la lista dentro de la página, para cambiar de contenido sin volver al comienzo.

## Datos y límites

Se mantienen las consultas de solo lectura a `stock_availability` y `stock_movements`, filtradas por `company_id`, bajo los permisos existentes. No hay cambios de base, inventario ni cuentas. Se muestran hasta 50 movimientos recientes, igual que antes, indicando ese límite; sus filtros se aplican a esos registros, no a todo el historial. Inventario: 12 productos por página; movimientos: 10 registros por página.

Se consultan ambas fuentes en paralelo y se descartan respuestas al desmontar el componente. Un cambio de comercio remonta el espacio para no conservar el inventario anterior. Los errores se muestran expresamente, sin presentarlos como stock vacío. Las horas se muestran en America/Lima.

## Comparar y revertir

La vista nueva abre en `/my-stock`. El botón **Vista anterior**, arriba, abre `/my-stock?vista=clasica`; desde allí se puede volver al nuevo diseño. Es una preferencia visual de la URL y no altera datos.

La copia original exacta está en `src/pages/MyStockClassic.tsx` y en `work/checkpoints/mi-stock-2026-11-06/MyStock.tsx`. SHA-256 original: `A63611BC831105E8E860D9902A12A214935EEFFDEB9EBC400ABF6EFB00027901`.

Para retirar toda la propuesta, restaurar únicamente `src/pages/MyStock.tsx` desde el checkpoint y volver a compilar/publicar. Los componentes de `src/components/merchant-stock` y la copia clásica pueden retirarse después; no requieren revertir otras funciones ni migraciones.

## Verificación

Compilación TypeScript/Vite y ESLint de los archivos nuevos y la página. El navegador automatizado no permitió completar la inspección visual porque no pudo verificar la URL actual. Queda pendiente revisar el aspecto y las interacciones en escritorio, tablet y celular con una sesión de comercio. No se afirma verificación visual en dispositivos físicos.

Referencia de estructura: https://www.lightningdesignsystem.com/components/page-headers/
