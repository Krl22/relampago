import type { Database } from "../types/database";

type ProfileLike = Pick<Database["public"]["Tables"]["profiles"]["Row"], "role" | "is_courier">;

/** El reparto requiere una cuenta independiente de motorizado. */
export function actsAsCourier(profile: ProfileLike | null | undefined): boolean {
  return profile?.role === "courier";
}

/** ¿Es admin o staff? (independiente de si además reparte) */
export function isStaffRole(profile: ProfileLike | null | undefined): boolean {
  return profile?.role === "admin" || profile?.role === "staff";
}

/** Nombre del rol tal como se muestra en la app. */
export const ROLE_LABELS: Record<Database["public"]["Enums"]["user_role"], string> = {
  admin: "Administrador",
  staff: "Supervisor",
  courier: "Motorizado",
  client: "Comercio",
};
