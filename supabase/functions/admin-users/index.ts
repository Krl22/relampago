// Gestión de accesos de comercios desde el panel (requiere la service_role, por eso vive aquí y no en el cliente).
//   create          crea la cuenta (correo + contraseña, sin confirmación) y la vincula a la empresa
//   reset_password  cambia la contraseña de una cuenta de comercio
//   delete          elimina la cuenta de comercio (auth.users -> cascade a profiles)
//   impersonate     "Ver como": devuelve un token de un solo uso para entrar como otro usuario (QA)
//   impersonate_end marca el fin de un "Ver como" en el registro
// Solo admin/staff pueden llamarla; create/reset/delete solo tocan cuentas con rol 'client'.
// "Ver como" es solo para admins y nunca como otro admin; cada ingreso queda en impersonation_log.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body =
  | { action: "create"; email: string; password: string; full_name?: string; company_id: string }
  | { action: "reset_password"; user_id: string; password: string }
  | { action: "delete"; user_id: string }
  | { action: "impersonate"; user_id: string }
  | { action: "impersonate_end"; log_id: string };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const friendly = (msg: string) => {
  const m = msg.toLowerCase();
  if (m.includes("already been registered") || m.includes("already exists")) return "Ese correo ya tiene una cuenta.";
  if (m.includes("invalid email") || m.includes("unable to validate email")) return "Correo inválido.";
  if (m.includes("password")) return "La contraseña debe tener al menos 8 caracteres.";
  return msg;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ¿Quién llama? Se valida la sesión del usuario con la anon key + su JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Sin sesión" });
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
      error: userError,
    } = await caller.auth.getUser();
    if (userError || !user) return json(401, { error: "Sesión inválida" });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    const peek = (await req.clone().json().catch(() => ({}))) as { action?: string };
    // Terminar un "Ver como" lo pide la sesión del usuario visto (puede no ser admin)
    if (peek.action !== "impersonate_end" && (!callerProfile || !["admin", "staff"].includes(callerProfile.role))) {
      return json(403, { error: "Solo admin o staff pueden gestionar accesos" });
    }

    const body = (await req.json()) as Body;

    if (body.action === "impersonate") {
      if (callerProfile?.role !== "admin") return json(403, { error: "Solo los administradores pueden usar “Ver como”" });
      if (!body.user_id || body.user_id === user.id) return json(400, { error: "Elige otro usuario" });
      const { data: target } = await admin.from("profiles").select("id, role, full_name").eq("id", body.user_id).single();
      if (!target) return json(404, { error: "Usuario no encontrado" });
      if (target.role === "admin") return json(400, { error: "No se puede entrar como otro administrador" });
      const { data: authUser, error: authError } = await admin.auth.admin.getUserById(target.id);
      if (authError || !authUser.user?.email) return json(400, { error: "Ese usuario no tiene correo para iniciar sesión" });
      // Enlace mágico generado en el servidor (no se envía correo): el panel lo canjea por una sesión
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: authUser.user.email });
      if (linkError || !link.properties?.hashed_token) return json(500, { error: linkError?.message ?? "No se pudo generar el acceso" });
      const { data: log } = await admin
        .from("impersonation_log")
        .insert({ admin_id: user.id, target_id: target.id, target_role: target.role })
        .select("id")
        .single();
      return json(200, { token_hash: link.properties.hashed_token, log_id: log?.id ?? null, role: target.role, full_name: target.full_name });
    }

    if (body.action === "impersonate_end") {
      // La llamada llega con la sesión del usuario visto; solo cierra registros donde él es el objetivo
      if (body.log_id) await admin.from("impersonation_log").update({ ended_at: new Date().toISOString() }).eq("id", body.log_id).eq("target_id", user.id);
      return json(200, { ok: true });
    }

    if (body.action === "create") {
      const email = (body.email ?? "").trim().toLowerCase();
      const password = body.password ?? "";
      const fullName = (body.full_name ?? "").trim() || null;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "Correo inválido" });
      if (password.length < 8) return json(400, { error: "La contraseña debe tener al menos 8 caracteres" });
      if (!body.company_id) return json(400, { error: "Falta la empresa" });
      const { data: company } = await admin.from("companies").select("id").eq("id", body.company_id).single();
      if (!company) return json(404, { error: "Empresa no encontrada" });

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : {},
      });
      if (error || !data.user) return json(400, { error: friendly(error?.message ?? "No se pudo crear la cuenta") });

      // El trigger ya creó el perfil como 'client'; aquí se vincula a la empresa.
      const { error: linkError } = await admin
        .from("profiles")
        .upsert({ id: data.user.id, role: "client", company_id: body.company_id, full_name: fullName, email }, { onConflict: "id" });
      if (linkError) return json(500, { error: "Cuenta creada pero no se pudo vincular: " + linkError.message });

      return json(200, { user_id: data.user.id });
    }

    // reset_password / delete: solo cuentas de comercio
    const targetId = "user_id" in body ? body.user_id : "";
    if (!targetId) return json(400, { error: "Falta el usuario" });
    const { data: target } = await admin.from("profiles").select("role").eq("id", targetId).single();
    if (!target || target.role !== "client") return json(400, { error: "Solo se pueden gestionar cuentas de comercio" });

    if (body.action === "reset_password") {
      if ((body.password ?? "").length < 8) return json(400, { error: "La contraseña debe tener al menos 8 caracteres" });
      const { error } = await admin.auth.admin.updateUserById(targetId, { password: body.password });
      if (error) return json(400, { error: friendly(error.message) });
      return json(200, { ok: true });
    }

    if (body.action === "delete") {
      const { error } = await admin.auth.admin.deleteUser(targetId);
      if (error) return json(400, { error: error.message });
      return json(200, { ok: true });
    }

    return json(400, { error: "Acción desconocida" });
  } catch (e) {
    return json(500, { error: (e as Error).message ?? String(e) });
  }
});
