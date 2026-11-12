// Gestión de accesos de comercios desde el panel (requiere la service_role, por eso vive aquí y no en el cliente).
//   create          prepara una invitación; NO confirma correo ni concede acceso al comercio
//   activate        el propio destinatario verificado establece su contraseña y activa el acceso
//   reset_password  cambia la contraseña de una cuenta de comercio
//   delete          elimina la cuenta de comercio (auth.users -> cascade a profiles)
//   impersonate     "Ver como": devuelve un token de un solo uso para entrar como otro usuario (QA)
//   impersonate_end marca el fin de un "Ver como" en el registro
// Solo admin/staff pueden llamarla; create/reset/delete solo tocan cuentas con rol 'client'.
// "Ver como" es solo para admins y nunca como otro admin; cada ingreso queda en impersonation_log.
//   list_staff / create_staff / reset_staff_password / delete_staff
//                   cuentas de Supervisor (rol 'staff'); solo admin, y solo tocan cuentas con ese rol
import { createClient } from "npm:@supabase/supabase-js@2.95.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body =
  | { action: "create_courier"; email: string; password: string; full_name: string }
  | { action: "create"; email: string; full_name?: string; company_id: string }
  | { action: "list"; company_id: string }
  | { action: "search"; query: string }
  | { action: "resend_invite"; user_id: string }
  | { action: "activate"; password: string }
  | { action: "link"; user_id: string; company_id: string }
  | { action: "unlink"; user_id: string }
  | { action: "reset_password"; user_id: string; password: string }
  | { action: "delete"; user_id: string }
  | { action: "impersonate"; user_id: string; company_id?: string }
  | { action: "impersonate_end"; log_id: string }
  | { action: "list_staff" }
  | { action: "create_staff"; email: string; password: string; full_name: string }
  | { action: "reset_staff_password"; user_id: string; password: string }
  | { action: "delete_staff"; user_id: string };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const friendly = (msg: string) => {
  const m = msg.toLowerCase();
  if (m.includes("already been registered") || m.includes("already exists")) return "Ese correo ya tiene una cuenta.";
  if (m.includes("invalid email") || m.includes("unable to validate email")) return "Correo inválido.";
  if (m.includes("email address not authorized")) return "Supabase requiere configurar SMTP para enviar invitaciones a correos de comercios.";
  if (m.includes("rate limit") || m.includes("security purposes")) return "Espera unos minutos antes de reenviar. Se alcanzó el límite de correos.";
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
    const body = (await req.json()) as Body;
    const redirectTo = `${Deno.env.get("MERCHANT_PORTAL_URL") ?? "https://relampago-courier.carthe5kboy.workers.dev"}/activar-cuenta`;

    // No plaintext password goes to staff. Only the authenticated, verified recipient can activate.
    if (body.action === "activate") {
      if (callerProfile?.role !== "client" || !user.email_confirmed_at || user.app_metadata?.merchant_activation_required !== true) {
        return json(403, { error: "Abre la invitación enviada a tu correo para activar esta cuenta." });
      }
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
        return json(400, { error: "La contraseña debe tener entre 8 y 128 caracteres." });
      }
      const { data: invitation, error: invitationError } = await admin.from("company_access_invitations").select("company_id").eq("user_id", user.id).is("activated_at", null).maybeSingle();
      if (invitationError || !invitation) return json(400, { error: "No hay una invitación pendiente. Contacta a Relámpago." });
      // Password first; failures leave the invitation pending and can be retried safely.
      const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, { password: body.password });
      if (passwordError) return json(400, { error: friendly(passwordError.message) });
      const { error: linkError } = await admin.from("profiles").update({ company_id: invitation.company_id }).eq("id", user.id).eq("role", "client");
      if (linkError) return json(500, { error: "Contraseña guardada, pero no se pudo activar el comercio. Intenta de nuevo." });
      const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, merchant_activation_required: false } });
      if (metadataError) return json(500, { error: "No se pudo finalizar la activación. Intenta de nuevo." });
      const { error: markError } = await admin.from("company_access_invitations").update({ activated_at: new Date().toISOString() }).eq("user_id", user.id);
      if (markError) console.error("Invitation activation timestamp:", markError.code);
      return json(200, { ok: true });
    }
    // Terminar un "Ver como" lo pide la sesión del usuario visto (puede no ser admin)
    if (body.action !== "impersonate_end" && (!callerProfile || !["admin", "staff"].includes(callerProfile.role))) {
      return json(403, { error: "Solo admin o staff pueden gestionar accesos" });
    }
    // El supervisor (staff) solo consulta accesos; crear, vincular, resetear o eliminar cuentas es de admin
    const READ_ONLY_ACTIONS = ["list", "search", "impersonate_end"];
    if (callerProfile?.role !== "admin" && !READ_ONLY_ACTIONS.includes(body.action)) {
      return json(403, { error: "Solo un administrador puede crear o modificar cuentas" });
    }

    // A secondary courier login is a separate Auth identity, never an upgrade of an existing account.
    if (body.action === "create_courier") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const name = typeof body.full_name === "string" ? body.full_name.trim() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || name.length < 2 || name.length > 150) {
        return json(400, { error: "Indica un nombre y un correo válido para la cuenta de motorizado." });
      }
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
        return json(400, { error: "La contraseña debe tener entre 8 y 128 caracteres." });
      }
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password: body.password, email_confirm: true, user_metadata: { full_name: name },
      });
      if (createError || !created.user) return json(400, { error: friendly(createError?.message ?? "No se pudo crear la cuenta.") });
      const { data: courier, error: roleError } = await admin.from("profiles")
        .update({ role: "courier", company_id: null, full_name: name })
        .eq("id", created.user.id).select("id, role").single();
      if (roleError || courier?.role !== "courier") {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
        if (cleanupError) console.error("Courier account setup requires cleanup", created.user.id);
        return json(500, { error: "No se pudo preparar el perfil de motorizado. Contacta con soporte antes de reintentar." });
      }
      return json(200, { id: courier.id, role: courier.role });
    }

    // Supervisores: cuentas internas con contraseña inicial que el admin entrega en persona
    if (body.action === "list_staff") {
      const { data, error } = await admin.from("profiles").select("id, full_name, email, created_at").eq("role", "staff").order("created_at");
      if (error) return json(500, { error: "No se pudieron cargar los supervisores." });
      const users = await Promise.all((data ?? []).map(async (p) => {
        const { data: a } = await admin.auth.admin.getUserById(p.id);
        return { ...p, last_sign_in_at: a.user?.last_sign_in_at ?? null };
      }));
      return json(200, { users });
    }
    if (body.action === "create_staff") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const name = typeof body.full_name === "string" ? body.full_name.trim() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || name.length < 2 || name.length > 150) {
        return json(400, { error: "Indica un nombre y un correo válido para el supervisor." });
      }
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
        return json(400, { error: "La contraseña debe tener entre 8 y 128 caracteres." });
      }
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password: body.password, email_confirm: true, user_metadata: { full_name: name },
      });
      if (createError || !created.user) return json(400, { error: friendly(createError?.message ?? "No se pudo crear la cuenta.") });
      const { data: staff, error: roleError } = await admin.from("profiles")
        .update({ role: "staff", company_id: null, full_name: name })
        .eq("id", created.user.id).select("id, role").single();
      if (roleError || staff?.role !== "staff") {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
        if (cleanupError) console.error("Staff account setup requires cleanup", created.user.id);
        return json(500, { error: "No se pudo preparar el perfil de supervisor. Intenta de nuevo." });
      }
      return json(200, { id: staff.id, role: staff.role });
    }
    if (body.action === "reset_staff_password" || body.action === "delete_staff") {
      const { data: target } = await admin.from("profiles").select("role").eq("id", body.user_id ?? "").maybeSingle();
      if (!target || target.role !== "staff") return json(400, { error: "Esa cuenta no es de un supervisor." });
      if (body.action === "reset_staff_password") {
        if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
          return json(400, { error: "La contraseña debe tener entre 8 y 128 caracteres." });
        }
        const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
        if (error) return json(400, { error: friendly(error.message) });
        return json(200, { ok: true });
      }
      const { error } = await admin.auth.admin.deleteUser(body.user_id);
      if (error) return json(400, { error: "No se pudo quitar el acceso. Si tiene pedidos o entregas registradas, contacta a soporte." });
      return json(200, { ok: true });
    }

    const profileFields = "id, full_name, email, company_id, created_at";
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const accessState = (u: { email_confirmed_at?: string; app_metadata: Record<string, unknown> }) =>
      u.app_metadata?.merchant_activation_required === true ? (u.email_confirmed_at ? "pending_password" : "pending_email") : (u.email_confirmed_at ? "active" : "unverified");

    if (body.action === "list") {
      if (!uuid.test(body.company_id ?? "")) return json(400, { error: "Empresa inválida" });
      const [profilesResult, invitesResult] = await Promise.all([
        admin.from("profiles").select(profileFields).eq("company_id", body.company_id).eq("role", "client").order("created_at"),
        admin.from("company_access_invitations").select("user_id, last_sent_at").eq("company_id", body.company_id).is("activated_at", null),
      ]);
      if (profilesResult.error || invitesResult.error) return json(500, { error: "No se pudieron cargar los accesos." });
      const profiles = profilesResult.data ?? [];
      const missingIds = (invitesResult.data ?? []).map((i) => i.user_id).filter((id) => !profiles.some((p) => p.id === id));
      if (missingIds.length) {
        const { data, error } = await admin.from("profiles").select(profileFields).in("id", missingIds).eq("role", "client");
        if (error) return json(500, { error: "No se pudieron cargar las invitaciones." });
        profiles.push(...(data ?? []));
      }
      const users = await Promise.all(profiles.map(async (p) => {
        const { data, error } = await admin.auth.admin.getUserById(p.id);
        if (error || !data.user) throw new Error("No se pudo verificar el estado de una cuenta.");
        return { ...p, access_status: accessState(data.user), last_sent_at: invitesResult.data?.find((i) => i.user_id === p.id)?.last_sent_at ?? null };
      }));
      // A timestamp-write failure must not make a previously activated/moved account
      // appear linked to its old company through the invitation audit row.
      return json(200, { users: users.filter((u) => u.company_id === body.company_id || u.access_status === "pending_email" || u.access_status === "pending_password") });
    }

    if (body.action === "search") {
      const query = (body.query ?? "").trim();
      if (query.length < 3) return json(200, { users: [] });
      const { data, error } = await admin.from("profiles").select(profileFields).eq("role", "client").ilike("email", `%${query.replace(/[%_]/g, "")}%`).limit(8);
      if (error) return json(500, { error: "No se pudieron buscar las cuentas." });
      const candidates = await Promise.all((data ?? []).map(async (p) => {
        const { data, error } = await admin.auth.admin.getUserById(p.id);
        return !error && data.user && accessState(data.user) === "active" ? p : null;
      }));
      return json(200, { users: candidates.filter(Boolean) });
    }

    if (body.action === "impersonate") {
      if (callerProfile?.role !== "admin") return json(403, { error: "Solo los administradores pueden usar “Ver como”" });
      if (!body.user_id || body.user_id === user.id) return json(400, { error: "Elige otro usuario" });
      const { data: target } = await admin.from("profiles").select("id, role, full_name, company_id").eq("id", body.user_id).single();
      if (!target) return json(404, { error: "Usuario no encontrado" });
      if (body.company_id !== undefined && (target.role !== "client" || target.company_id !== body.company_id)) {
        return json(403, { error: "Esta cuenta ya no pertenece al comercio seleccionado. Recarga sus accesos." });
      }
      if (target.role === "admin") return json(400, { error: "No se puede entrar como otro administrador" });
      const { data: authUser, error: authError } = await admin.auth.admin.getUserById(target.id);
      if (authError || !authUser.user?.email) return json(400, { error: "Ese usuario no tiene correo para iniciar sesión" });
      if (authUser.user.app_metadata?.merchant_activation_required === true || !authUser.user.email_confirmed_at) return json(403, { error: "La cuenta debe verificar su correo y completar su activación antes de usar “Ver como”." });
      // Enlace mágico generado en el servidor (no se envía correo): el panel lo canjea por una sesión
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: authUser.user.email });
      if (linkError || !link.properties?.hashed_token) return json(500, { error: linkError?.message ?? "No se pudo generar el acceso" });
      const { data: log, error: logError } = await admin
        .from("impersonation_log")
        .insert({ admin_id: user.id, target_id: target.id, target_role: target.role })
        .select("id")
        .single();
      if (logError || !log) return json(500, { error: "No se pudo registrar el acceso. Inténtalo de nuevo." });
      return json(200, { token_hash: link.properties.hashed_token, log_id: log?.id ?? null, role: target.role, full_name: target.full_name });
    }

    if (body.action === "impersonate_end") {
      // La llamada llega con la sesión del usuario visto; solo cierra registros donde él es el objetivo
      if (body.log_id) await admin.from("impersonation_log").update({ ended_at: new Date().toISOString() }).eq("id", body.log_id).eq("target_id", user.id);
      return json(200, { ok: true });
    }

    if (body.action === "create") {
      const email = (body.email ?? "").trim().toLowerCase();
      const fullName = (body.full_name ?? "").trim() || null;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "Correo inválido" });
      if (!body.company_id) return json(400, { error: "Falta la empresa" });
      const { data: company } = await admin.from("companies").select("id").eq("id", body.company_id).single();
      if (!company) return json(404, { error: "Empresa no encontrada" });

      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: false,
        app_metadata: { merchant_activation_required: true },
        user_metadata: fullName ? { full_name: fullName } : {},
      });
      if (error || !data.user) return json(400, { error: friendly(error?.message ?? "No se pudo crear la cuenta") });

      // The trigger creates a client profile WITHOUT company_id, so RLS grants no company data.
      const { error: invitationError } = await admin.from("company_access_invitations").insert({ user_id: data.user.id, company_id: body.company_id });
      if (invitationError) {
        await admin.auth.admin.deleteUser(data.user.id); // Only rolls back the account created by this request.
        return json(500, { error: "No se pudo preparar la invitación. Intenta de nuevo." });
      }
      const { error: sendError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (!sendError) await admin.from("company_access_invitations").update({ last_sent_at: new Date().toISOString() }).eq("user_id", data.user.id);
      return json(200, { user_id: data.user.id, email_sent: !sendError, delivery_error: sendError ? friendly(sendError.message) : null });
    }

    // reset_password / delete: solo cuentas de comercio
    const targetId = "user_id" in body ? body.user_id : "";
    if (!targetId) return json(400, { error: "Falta el usuario" });
    const { data: target } = await admin.from("profiles").select("role").eq("id", targetId).single();
    if (!target || target.role !== "client") return json(400, { error: "Solo se pueden gestionar cuentas de comercio" });

    const { data: targetAuth, error: authError } = await admin.auth.admin.getUserById(targetId);
    if (authError || !targetAuth.user) return json(404, { error: "Cuenta no encontrada" });

    if (body.action === "resend_invite") {
      const { data: invitation } = await admin.from("company_access_invitations").select("user_id").eq("user_id", targetId).is("activated_at", null).maybeSingle();
      if (!invitation || targetAuth.user.app_metadata?.merchant_activation_required !== true || !targetAuth.user.email) return json(400, { error: "Esta cuenta no tiene una activación pendiente." });
      const { error } = targetAuth.user.email_confirmed_at
        ? await admin.auth.resetPasswordForEmail(targetAuth.user.email, { redirectTo })
        : await admin.auth.admin.inviteUserByEmail(targetAuth.user.email, { redirectTo });
      if (error) return json(400, { error: friendly(error.message) });
      await admin.from("company_access_invitations").update({ last_sent_at: new Date().toISOString() }).eq("user_id", targetId);
      return json(200, { ok: true });
    }

    if (body.action === "link" || body.action === "unlink") {
      if (accessState(targetAuth.user) !== "active") return json(400, { error: "Primero debe verificar el correo y completar su activación." });
      if (body.action === "link") {
        if (!uuid.test(body.company_id ?? "")) return json(400, { error: "Empresa inválida" });
        const { data: company } = await admin.from("companies").select("id").eq("id", body.company_id).single();
        if (!company) return json(404, { error: "Empresa no encontrada" });
      }
      const { error } = await admin.from("profiles").update({ company_id: body.action === "link" ? body.company_id : null }).eq("id", targetId).eq("role", "client");
      if (error) return json(400, { error: "No se pudo actualizar la vinculación." });
      return json(200, { ok: true });
    }

    if (body.action === "reset_password") {
      if (accessState(targetAuth.user) !== "active") return json(403, { error: "La cuenta pendiente debe activarse desde el correo. Reenvía la invitación." });
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
