import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "../lib/supabase";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Card, CardContent } from "./ui/card";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { Database } from "../types/database";

type Company = Database["public"]["Tables"]["companies"]["Row"];

// Lista de distritos con sus precios
const DISTRICTS = [
  "Ate (s/10.00 - s/13.00 - s/16.00)",
  "Barranco (s/10.00)",
  "Breña (s/10.00)",
  "Callao (s/10.00 - s/13.00)",
  "Carabayllo (s/13.00 - s/16.00 -s/19.00)",
  "Cercado (s/10.00-s/13.00)",
  "Chorrillos (s/10.00)",
  "Comas (De s/10.00 - s/13.00)",
  "El Agustino (s/10.00)",
  "Independencia (s/10.00 - s/13.00)",
  "Jesus María (s/10.00)",
  "La Molina (De s/10.00 - S/13.00)",
  "La Victoria (s/10.00 - s/13.00)",
  "Lince (s/10.00)",
  "Los Olivos (s/10.00)",
  "Lurigancho (S/13.00 - s/16.00)",
  "Lurín (s/13.00 - s/16.00)",
  "Magdalena (s/10.00)",
  "Miraflores (s/10.00)",
  "Pueblo Libre (s/10.00)",
  "Puente Piedra (s/13.00 - s/16.00 - s/19.00)",
  "Rímac (s/10.00 - s/13.00)",
  "San Borja (s/10.00)",
  "San Isidro (s/10.00)",
  "San Juan de Lurigancho (De s/10.00 - S/13.00 -s/16.00)",
  "San Juan de Miraflores (s/10.00 - s/13.00)",
  "San Luis (s/10.00)",
  "San Martín de Porres (s/10.00 - s/13.00)",
  "San Miguel (s/10.00)",
  "Santa Anita (s/10.00)",
  "Surco (s/10.00)",
  "Surquillo (s/10.00)",
  "Villa El Salvador (s/10.00 - S/13.00)",
  "Villa María Del Triunfo (s/10.00 - S/13.00)",
  "Pachacamac (s/13.00 - s/16.00)",
  "Ventanilla (s/13.00 - s/16.00 - s/19.00)",
  "Agencia Shalom (S/10.00)",
  "Agencia Olva (s/10.00)",
  "Agencia Marvisur (s/10.00)",
  "Agencia Urbano (s/10.00)",
  "Otras Agencias (s/10.00 - s/13.00)",
];

const formSchema = z.object({
  sender_name: z.string().min(2, "El nombre del negocio es requerido"),
  recipient_name: z.string().min(2, "El nombre del destinatario es requerido"),
  recipient_phone: z.string().min(6, "El teléfono es requerido"),
  district: z.string().min(1, "Selecciona un distrito"),
  delivery_address: z.string().min(5, "La dirección es requerida"),
  product_details: z.string().min(2, "Detalla los productos"),
  packages_count: z.coerce.number().min(1, "Debe ser al menos 1 paquete"),
  amount_to_collect: z.coerce.number().min(0),
  comments: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface OrderFormProps {
  onSuccess?: () => void;
  isAdmin?: boolean;
}

export function OrderForm({ onSuccess }: OrderFormProps) {
  const [isSuccess, setIsSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      packages_count: 1,
      amount_to_collect: 0,
    },
  });

  const senderName = watch("sender_name");

  useEffect(() => {
    if (senderName && companies.length > 0) {
      const filtered = companies.filter((c) =>
        c.name.toLowerCase().includes(senderName.toLowerCase()),
      );
      setFilteredCompanies(filtered);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [senderName, companies]);

  useEffect(() => {
    const fetchCompanies = async () => {
      const { data } = await supabase.from("companies").select("*");
      if (data) setCompanies(data);
    };
    fetchCompanies();
  }, []);

  const onSubmit = async (data: FormValues) => {
    setServerError(null);
    try {
      // Buscar si el nombre ingresado coincide exactamente con una empresa existente
      let matchedCompany = companies.find(
        (c) => c.name.toLowerCase() === data.sender_name.toLowerCase(),
      );

      let companyId = matchedCompany ? matchedCompany.id : null;

      // Si no existe, crear la empresa automáticamente
      if (!matchedCompany) {
        const { data: newCompany, error: createCompanyError } = await supabase
          .from("companies")
          .insert({ name: data.sender_name })
          .select()
          .single();

        if (createCompanyError) {
          console.error("Error creating company:", createCompanyError);
          // Si falla la creación (ej. error de red), seguimos sin company_id
        } else if (newCompany) {
          companyId = newCompany.id;
        }
      }

      const { error } = await supabase.from("orders").insert({
        sender_name: data.sender_name,
        company_id: companyId,
        recipient_name: data.recipient_name,
        recipient_phone: data.recipient_phone,
        destination_district: data.district,
        destination_address: data.delivery_address,
        product_details: data.product_details,
        packages_count: data.packages_count,
        amount_to_collect: data.amount_to_collect,
        comments: data.comments,
        status: "pending",
        // Si es público, no asignamos company_id ni user_id por ahora
        // Si quisiéramos linkearlo, necesitaríamos lógica extra
      });

      if (error) throw error;

      setIsSuccess(true);
      reset();
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error("Error creating order:", error);
      setServerError(
        (error as Error).message ||
          "Error al crear el pedido. Inténtalo de nuevo.",
      );
    }
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col justify-center items-center p-8 space-y-4 text-center">
        <div className="p-3 bg-green-100 rounded-full">
          <CheckCircle2 className="w-12 h-12 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">
          ¡Pedido Registrado!
        </h2>
        <p className="text-gray-600">
          Tu pedido ha sido enviado exitosamente a Relámpago Courier.
        </p>
        <Button onClick={() => setIsSuccess(false)} className="mt-4">
          Registrar otro pedido
        </Button>
      </div>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {serverError && (
            <div className="p-3 text-sm rounded-md bg-destructive/15 text-destructive">
              {serverError}
            </div>
          )}

          <div className="relative space-y-2">
            <Label htmlFor="sender_name">
              Nombre de su negocio (Remitente)
            </Label>
            <Input
              id="sender_name"
              {...register("sender_name")}
              placeholder="Ej. Tienda Express"
              autoComplete="off"
              onFocus={() => {
                if (senderName) setShowSuggestions(true);
              }}
              onBlur={() => {
                // Delay to allow click on suggestion
                setTimeout(() => setShowSuggestions(false), 200);
              }}
            />
            {showSuggestions && filteredCompanies.length > 0 && (
              <ul className="overflow-auto absolute z-10 mt-1 w-full max-h-60 bg-white rounded-md border border-gray-200 shadow-lg">
                {filteredCompanies.map((company) => (
                  <li
                    key={company.id}
                    className="px-4 py-2 text-sm cursor-pointer hover:bg-gray-100"
                    onClick={() => {
                      setValue("sender_name", company.name);
                      setShowSuggestions(false);
                    }}
                  >
                    {company.name}
                  </li>
                ))}
              </ul>
            )}
            {errors.sender_name && (
              <span className="text-sm text-destructive">
                {errors.sender_name.message}
              </span>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recipient_name">Nombre del destinatario</Label>
              <Input
                id="recipient_name"
                {...register("recipient_name")}
                placeholder="Ej. Juan Pérez"
              />
              {errors.recipient_name && (
                <span className="text-sm text-destructive">
                  {errors.recipient_name.message}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="recipient_phone">Teléfono del destinatario</Label>
              <Input
                id="recipient_phone"
                {...register("recipient_phone")}
                placeholder="Ej. 999 999 999"
                type="tel"
              />
              {errors.recipient_phone && (
                <span className="text-sm text-destructive">
                  {errors.recipient_phone.message}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="district">Distrito del destinatario</Label>
            <select
              id="district"
              {...register("district")}
              className="flex justify-between items-center px-3 py-2 w-full h-10 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Seleccionar distrito...</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {errors.district && (
              <span className="text-sm text-destructive">
                {errors.district.message}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="delivery_address">
              Dirección del destinatario (con referencias)
            </Label>
            <Textarea
              id="delivery_address"
              {...register("delivery_address")}
              placeholder="Ej. Av. Larco 123, frente al parque..."
            />
            {errors.delivery_address && (
              <span className="text-sm text-destructive">
                {errors.delivery_address.message}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="product_details">Detalle los productos</Label>
            <Textarea
              id="product_details"
              {...register("product_details")}
              placeholder="Ej. 2 Polos talla M, 1 Zapatilla..."
            />
            {errors.product_details && (
              <span className="text-sm text-destructive">
                {errors.product_details.message}
              </span>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="packages_count">Cantidad de paquetes</Label>
              <Input
                id="packages_count"
                type="number"
                min="1"
                {...register("packages_count")}
              />
              {errors.packages_count && (
                <span className="text-sm text-destructive">
                  {errors.packages_count.message}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount_to_collect">Monto a cobrar (S/.)</Label>
              <Input
                id="amount_to_collect"
                type="number"
                min="0"
                step="0.01"
                {...register("amount_to_collect")}
                onKeyDown={(e) => {
                  // Prevenir caracteres no numéricos excepto punto y teclas de control
                  if (
                    !/[0-9]/.test(e.key) &&
                    e.key !== "." &&
                    e.key !== "Backspace" &&
                    e.key !== "Delete" &&
                    e.key !== "Tab" &&
                    e.key !== "ArrowLeft" &&
                    e.key !== "ArrowRight"
                  ) {
                    e.preventDefault();
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Si no hay cobro, dejar en 0.
              </p>
              {errors.amount_to_collect && (
                <span className="text-sm text-destructive">
                  {errors.amount_to_collect.message}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments">Comentarios adicionales</Label>
            <Textarea
              id="comments"
              {...register("comments")}
              placeholder="Instrucciones especiales para el repartidor..."
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                Registrando...
              </>
            ) : (
              "Registrar Pedido"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
