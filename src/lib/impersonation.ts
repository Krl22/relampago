// "Ver como": un admin entra con la sesión real de otro usuario (motorizado, comercio o staff) para QA.
// La Edge Function admin-users emite un token de un solo uso y deja el ingreso en impersonation_log.
// La sesión del admin se guarda aquí para volver a ella; se usa localStorage porque la sesión de
// Supabase también vive ahí y la comparten todas las pestañas.
import { supabase } from "./supabase";
import { callAdminUsers } from "./adminUsers";
import type { UserRole } from "../types/database";

const KEY = "relampago.impersonation";

export type Impersonation = {
  admin: { access_token: string; refresh_token: string; name: string | null };
  target: { id: string; name: string | null; role: UserRole };
  logId: string | null;
  startedAt: string;
};

export function getImpersonation(): Impersonation | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Impersonation) : null;
  } catch {
    return null;
  }
}

const homeFor = (role: UserRole) => (role === "courier" ? "/my-deliveries" : role === "client" ? "/mis-pedidos" : "/");

export async function startImpersonation(target: { id: string; name: string | null }, adminName: string | null) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Tu sesión expiró; vuelve a iniciar sesión.");
  const res = await callAdminUsers<{ token_hash: string; log_id: string | null; role: UserRole; full_name: string | null }>({
    action: "impersonate",
    user_id: target.id,
  });
  const info: Impersonation = {
    admin: { access_token: session.access_token, refresh_token: session.refresh_token, name: adminName },
    target: { id: target.id, name: res.full_name ?? target.name, role: res.role },
    logId: res.log_id,
    startedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(info));
  } catch {
    throw new Error("El navegador no permite guardar la sesión de vuelta; no se puede usar “Ver como” aquí.");
  }
  // Evita que el cliente rote el token del admin mientras cambiamos de sesión
  await supabase.auth.stopAutoRefresh();
  const { error } = await supabase.auth.verifyOtp({ token_hash: res.token_hash, type: "magiclink" });
  if (error) {
    localStorage.removeItem(KEY);
    await supabase.auth.startAutoRefresh();
    throw error;
  }
  window.location.assign(homeFor(res.role));
}

/** Vuelve a la cuenta del admin. Solo cierra la sesión de "Ver como" (el usuario real sigue conectado en su equipo). */
export async function stopImpersonation(): Promise<never> {
  const info = getImpersonation();
  if (info) {
    await callAdminUsers({ action: "impersonate_end", log_id: info.logId }).catch(() => undefined);
    await supabase.auth.signOut({ scope: "local" });
    const { error } = await supabase.auth.setSession({ access_token: info.admin.access_token, refresh_token: info.admin.refresh_token });
    localStorage.removeItem(KEY);
    window.location.assign(error ? "/login" : "/");
  }
  // La página se recarga; nada más debe correr después
  return new Promise<never>(() => {});
}
