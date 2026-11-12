import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { supabase } from "../lib/supabase";
import { callAdminUsers } from "../lib/adminUsers";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Loader2, MailCheck, Zap } from "lucide-react";

export default function ActivateAccount() {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Supabase consumes successful callback tokens; failed/expired callbacks retain an error.
  const [invalidLink] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const search = new URLSearchParams(window.location.search);
    return hash.has("error") || hash.has("error_code") || search.has("error") || search.has("error_code");
  });
  const navigate = useNavigate();
  const pending = user?.app_metadata?.merchant_activation_required === true;
  const canActivate = !invalidLink && pending && profile?.role === "client" && !!user?.email_confirmed_at;

  const activate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canActivate || busy) return;
    setError(null);
    if (password.length < 8 || password.length > 128) {
      setError("Usa una contraseña de entre 8 y 128 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await callAdminUsers({ action: "activate", password });
      setPassword("");
      setConfirmation("");
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw new Error("Cuenta activada. Cierra sesión e ingresa con tu nueva contraseña.");
      await refreshProfile();
      navigate("/mis-pedidos", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <main data-page="activation" className="flex min-h-dvh items-center justify-center bg-primary p-4">
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader className="space-y-3 text-center">
        <Zap className="mx-auto h-9 w-9 fill-secondary text-secondary" />
        <CardTitle>Activa tu cuenta de Relámpago</CardTitle>
        <CardDescription>Verifica tu correo y elige tu contraseña para acceder al portal de tu comercio.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <p role="status" className="text-center">Verificando enlace…</p> : canActivate ? <form onSubmit={(event) => void activate(event)} className="space-y-4">
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-800"><MailCheck className="mr-2 inline h-4 w-4" />Correo verificado: <span className="break-all">{user?.email}</span></div>
          <div className="space-y-2">
            <Label htmlFor="activation-password">Nueva contraseña</Label>
            <Input id="activation-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">Mínimo 8 caracteres. No compartas tu contraseña.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="activation-confirmation">Repite tu contraseña</Label>
            <Input id="activation-confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          </div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Activar acceso al comercio</Button>
        </form> : <div className="space-y-3 text-sm">
          {invalidLink || !user ? <p role="alert">El enlace no es válido, ya se utilizó o venció. Abre el correo más reciente o pide a Relámpago que reenvíe la invitación.</p>
            : pending ? <p role="alert">Primero verifica tu correo abriendo el enlace de la invitación enviada a {user.email}.</p>
              : <p>{profile?.role === "client" ? "Esta cuenta ya no tiene una activación pendiente." : "Esta sesión no corresponde a una cuenta de comercio pendiente. Abre la invitación del comercio en otra ventana."}</p>}
          {user && !pending && <Button variant="outline" className="w-full" onClick={() => navigate("/")}>Ir a mi cuenta</Button>}
        </div>}
        {!loading && (user ? <Button variant="ghost" className="w-full" disabled={busy} onClick={() => void signOut().then(() => navigate("/login"))}>Cerrar sesión</Button> : <Link to="/login" className="block text-center text-sm text-primary underline">Volver al inicio de sesión</Link>)}
      </CardContent>
    </Card>
  </main>;
}
