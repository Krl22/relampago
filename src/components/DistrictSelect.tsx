import { forwardRef } from "react";
import { priceText, useDistricts } from "../lib/districts";
import { cn } from "@/lib/utils";

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  /** Incluir agencias (solo para el destino de un envío). */
  includeAgencies?: boolean;
  /** Mostrar el precio al lado del nombre. */
  withPrices?: boolean;
  /** Texto de la opción vacía. */
  placeholder?: string;
};

const baseClass =
  "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Lista cerrada de distritos (catálogo de la base). Sirve con react-hook-form ({...register("x")})
 * o controlado (value / onChange). El valor guardado es siempre el nombre oficial.
 */
export const DistrictSelect = forwardRef<HTMLSelectElement, Props>(function DistrictSelect(
  { includeAgencies = false, withPrices = false, placeholder = "Seleccionar distrito…", className, ...props },
  ref,
) {
  const list = useDistricts();
  const districts = list.filter((d) => d.kind === "district");
  const agencies = includeAgencies ? list.filter((d) => d.kind === "agency") : [];
  const label = (d: (typeof list)[number]) => (withPrices ? `${d.name} (${priceText(d)})` : d.name);
  return (
    <select ref={ref} className={cn(baseClass, className)} {...props}>
      <option value="">{list.length === 0 ? "Cargando distritos…" : placeholder}</option>
      {agencies.length > 0 ? (
        <>
          <optgroup label="Distritos">
            {districts.map((d) => (
              <option key={d.name} value={d.name}>
                {label(d)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Agencias (envío a provincia)">
            {agencies.map((d) => (
              <option key={d.name} value={d.name}>
                {label(d)}
              </option>
            ))}
          </optgroup>
        </>
      ) : (
        districts.map((d) => (
          <option key={d.name} value={d.name}>
            {label(d)}
          </option>
        ))
      )}
    </select>
  );
});
