# Componentes reutilizables de Relámpago

Esta primera biblioteca permite componer páginas con el modelo de Lightning sin incorporar un editor visual ni depender del framework de Salesforce. Los componentes se encuentran en `src/components/design` y reciben datos o contenido por propiedades; no consultan bases de datos ni cambian permisos.

| Componente | Uso | Propiedades principales |
|---|---|---|
| `RecordHeader` | Cabecera del registro: identidad, metadatos y acciones | `title`, `subtitle`, `recordType`, `icon`, `meta`, `actions`, `utility`, `children` |
| `MetricStrip` | Indicadores compactos con etiquetas y valores | `items`, `columns` (4 o 5) |
| `RecordLayout` | Área principal y componentes relacionados | `children`, `aside`, `compact`, `hideAsideOnSmall` |
| `RecordTabs` | Pestañas accesibles para secciones | `tabs`, `selected`, `onSelect`, `label`, `children` |
| `PageLoading` | Estado de carga de una pantalla | Sin datos de negocio |
| `PageBoundary` | Recuperación ante un fallo de carga | `children` |
| `DesignSwitch` | Alternar entre Clásico y Lightning | `className` opcional |

`RecordHeader`, `MetricStrip` y `RecordLayout` se utilizan tanto en la ficha administrativa del comercio como en el espacio de inventario. `RecordTabs` organiza las secciones de la ficha, mantiene foco visible y admite flechas, Inicio/Fin y desplazamiento horizontal. Los componentes específicos de `company-record` y `merchant-stock` aportan los datos y las reglas de cada módulo, conservando la presentación compartida.

Ejemplo de composición:

```tsx
<RecordHeader title={company.name} recordType="Comercio" icon={Building2}
  actions={<Button onClick={refresh}>Actualizar</Button>}>
  <MetricStrip columns={5} items={summary} />
</RecordHeader>
<RecordLayout aside={<ContactPanel company={company} />}>
  <OrdersPanel companyId={company.id} />
</RecordLayout>
```

Clásico permanece como valor inicial. Las entradas nuevas a las fichas aparecen al optar por Lightning. La preferencia visual nueva (`relampago.design.v2`) evita activar automáticamente el diseño de prueba anterior; después se conserva la elección explícita del navegador.
