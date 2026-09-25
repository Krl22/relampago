import type { Database } from "../types/database";

type ProfileLike = Pick<Database["public"]["Tables"]["profiles"]["Row"], "role" | "is_courier">;

/** ¿Este perfil reparte? Motorizados siempre; admin/staff solo si tienen is_courier. */
export function actsAsCourier(profile: ProfileLike | null | undefined): boolean {
  return !!profile && (profile.role === "courier" || profile.is_courier);
}

/** ¿Es admin o staff? (independiente de si además reparte) */
export function isStaffRole(profile: ProfileLike | null | undefined): boolean {
  return profile?.role === "admin" || profile?.role === "staff";
}

/** Nombre del rol tal como se muestra en la app. */
export const ROLE_LABELS: Record<Database["public"]["Enums"]["user_role"], string> = {
  admin: "Administrador",
  staff: "Staff",
  courier: "Motorizado",
  client: "Comercio",
};
