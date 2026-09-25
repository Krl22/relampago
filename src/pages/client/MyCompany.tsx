import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../components/AuthProvider";
import { useMyCompany, type MyCompany as Company } from "../../hooks/useMyCompany";
import { CompanyAddressesEditor } from "../../components/CompanyAddressesDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Check, Loader2 } from "lucide-react";

/** Datos del comercio que el propio comercio puede cambiar + contraseña. */
export default function MyCompany() {
  const { user } = useAuth();
  const [reload, setReload] = useState(0);
  const { company, loading } = useMyCompany(reload);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (password.length < 8) {
      setPwMsg({ ok: false, text: "La contraseña debe tener al menos 8 caracteres." });
      return;
    }
    if (password !== password2) {
      setPwMsg({ ok: false, text: "Las contraseñas no coinciden." });
      return;
    }
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPwSaving(false);
    if (error) {
      setPwMsg({ ok: false, text: error.message });
      return;
    }
    setPassword("");
    setPassword2("");
    setPwMsg({ ok: true, text: "Contraseña actualizada." });
  };

  if (loading) return <div className="py-10 text-center text-sm text-muted-foreground">Cargando…</div>;
  if (!company) return <div className="py-10 text-center text-sm text-destructive">No se encontró tu comercio.</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Mi comercio</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{company.name}</CardTitle>
            <CardDescription>
              {company.ruc ? `RUC ${company.ruc} · ` : ""}
              Para cambiar el nombre o RUC escríbenos por WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* key: al recargar la empresa el formulario vuelve a arrancar de los datos guardados */}
            <CompanyDataForm key={`${company.id}-${reload}`} company={company} onSaved={() => setReload((t) => t + 1)} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mi cuenta</CardTitle>
              <CardDescription>{user?.email}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={changePassword} className="space-y-3">
                <div className="space-y-2">
                  <Label>Nueva contraseña</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                </div>
                <div className="space-y-2">
                  <Label>Repetir contraseña</Label>
                  <Input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
                </div>
                {pwMsg && <div className={pwMsg.ok ? "text-sm text-green-700" : "text-sm text-destructive"}>{pwMsg.text}</div>}
                <Button type="submit" variant="outline" disabled={pwSaving || !password}>
                  {pwSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cambiar contraseña
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Direcciones de recojo</CardTitle>
              <CardDescription>Donde recogemos tus paquetes. Para agregar o cambiar una dirección, pídela a Relámpago Courier.</CardDescription>
            </CardHeader>
            <CardContent>
              <CompanyAddressesEditor companyId={company.id} readOnly />
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">¿Alguien más de tu equipo necesita entrar? Pídele a Relámpago una cuenta adicional para tu comercio.</p>
        </div>
      </div>
    </div>
  );
}

function CompanyDataForm({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const { refreshProfile } = useAuth();
  const [form, setForm] = useState({
    contact_name: company.contact_name ?? "",
    phone: company.phone ?? "",
    email: company.email ?? "",
    yape_number: company.yape_number ?? "",
    yape_holder: company.yape_holder ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("update_my_company", { p: form });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSaved(true);
    await refreshProfile();
    setTimeout(onSaved, 1200);
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Persona de contacto</Label>
          <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Teléfono / WhatsApp</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Correo de contacto</Label>
        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Yape (número)</Label>
          <Input value={form.yape_number} onChange={(e) => setForm({ ...form, yape_number: e.target.value })} inputMode="tel" />
          <p className="text-xs text-muted-foreground">Ahí te abonamos lo recaudado.</p>
        </div>
        <div className="space-y-2">
          <Label>Yape (titular)</Label>
          <Input value={form.yape_holder} onChange={(e) => setForm({ ...form, yape_holder: e.target.value })} />
        </div>
      </div>
      {error && <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{error}</div>}
      <Button type="submit" disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : saved ? <Check className="mr-2 h-4 w-4" /> : null}
        {saved ? "Guardado" : "Guardar cambios"}
      </Button>
    </form>
  );
}
