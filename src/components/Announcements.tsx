import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import { useAuth } from "./AuthProvider";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Loader2, Megaphone } from "lucide-react";

type Announcement = Database["public"]["Tables"]["announcements"]["Row"];

const seenKey = (id: string) => `relampago.anuncio.${id}`;
const wasSeen = (id: string) => {
  try {
    return localStorage.getItem(seenKey(id)) === "1";
  } catch {
    return false;
  }
};
const markSeen = (id: string) => {
  try {
    localStorage.setItem(seenKey(id), "1");
  } catch {
    // sin almacenamiento: se volverá a mostrar la próxima vez
  }
};

/**
 * Comercio: el anuncio vigente se abre al entrar al portal (una vez por anuncio) y queda un
 * aviso arriba para volver a leerlo mientras siga publicado.
 */
export function MerchantAnnouncement() {
  const [item, setItem] = useState<Pick<Announcement, "id" | "title" | "body" | "created_at"> | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase
      .from("announcements")
      .select("id, title, body, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!alive || !data?.[0]) return;
        setItem(data[0]);
        if (!wasSeen(data[0].id)) setOpen(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!item) return null;
  const close = () => {
    markSeen(item.id);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-950 hover:bg-amber-100 print:hidden"
      >
        <Megaphone className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="min-w-0 flex-1 truncate">
          <b>{item.title}</b>
        </span>
        <span className="shrink-0 text-xs text-amber-700 underline">Ver anuncio</span>
      </button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-amber-600" /> {item.title}
            </DialogTitle>
            <DialogDescription>Relámpago Courier · {format(parseISO(item.created_at), "d 'de' MMMM", { locale: es })}</DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-line text-sm">{item.body}</p>
          <DialogFooter>
            <Button onClick={close}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Admin / staff: publicar, cambiar o quitar el anuncio que ven los comercios al entrar. */
export function AnnouncementAdminCard() {
  const { user } = useAuth();
  const [current, setCurrent] = useState<Announcement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    supabase
      .from("announcements")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!alive) return;
        const a = data?.[0] ?? null;
        // Vencido = ya no lo ven los comercios
        setCurrent(a && (!a.ends_at || new Date(a.ends_at) > new Date()) ? a : null);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const remove = async () => {
    if (!current || !globalThis.confirm("¿Quitar el anuncio? Los comercios dejarán de verlo.")) return;
    const { error } = await supabase.from("announcements").update({ active: false }).eq("id", current.id);
    if (error) alert(error.message);
    setReloadKey((k) => k + 1);
  };

  return (
    <Card className="border-amber-200 bg-amber-50/60">
      <CardContent className="flex flex-wrap items-start gap-3 p-4">
        <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Anuncio para comercios</p>
          {!loaded ? (
            <p className="text-xs text-muted-foreground">Cargando…</p>
          ) : current ? (
            <>
              <p className="truncate">
                <b>{current.title}</b> — {current.body}
              </p>
              <p className="text-xs text-muted-foreground">
                Publicado {format(parseISO(current.created_at), "d MMM HH:mm", { locale: es })}
                {current.ends_at && ` · se muestra hasta el ${format(parseISO(current.ends_at), "d MMM", { locale: es })}`}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Sin anuncio. Lo que publiques aparece a los comercios al entrar al portal.</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={current ? "outline" : "default"} onClick={() => setEditing(true)}>
            {current ? "Cambiar" : "Publicar anuncio"}
          </Button>
          {current && (
            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => void remove()}>
              Quitar
            </Button>
          )}
        </div>
      </CardContent>
      <AnnouncementEditor
        open={editing}
        onOpenChange={setEditing}
        initial={current}
        userId={user?.id ?? null}
        onSaved={() => {
          setEditing(false);
          setReloadKey((k) => k + 1);
        }}
      />
    </Card>
  );
}

function AnnouncementEditor({
  open,
  onOpenChange,
  initial,
  userId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Announcement | null;
  userId: string | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Anuncio para comercios</DialogTitle>
          <DialogDescription>Se abre a cada comercio al entrar al portal (una vez) y queda visible arriba mientras esté publicado.</DialogDescription>
        </DialogHeader>
        {open && <EditorBody initial={initial} userId={userId} onCancel={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function EditorBody({ initial, userId, onCancel, onSaved }: { initial: Announcement | null; userId: string | null; onCancel: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [until, setUntil] = useState(initial?.ends_at ? format(parseISO(initial.ends_at), "yyyy-MM-dd") : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    if (title.trim().length < 2 || body.trim().length < 2) {
      setError("Escribe un título y el mensaje.");
      return;
    }
    setSaving(true);
    setError(null);
    // Cada publicación es un anuncio nuevo: los comercios lo vuelven a ver aunque ya hayan leído el anterior
    const { error } = await supabase.from("announcements").insert({
      title: title.trim(),
      body: body.trim(),
      ends_at: until ? new Date(`${until}T23:59:59-05:00`).toISOString() : null,
      created_by: userId,
    });
    setSaving(false);
    if (error) setError(error.message);
    else onSaved();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Título</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Ej. Feriado 8 de octubre" />
      </div>
      <div className="space-y-2">
        <Label>Mensaje</Label>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={2000} placeholder="Ej. El miércoles 8 no hay reparto. Los pedidos de ese día se atienden el jueves 9." />
      </div>
      <div className="space-y-2">
        <Label>Mostrar hasta (opcional)</Label>
        <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-auto" />
      </div>
      {error && <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{error}</div>}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={() => void publish()} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Publicar
        </Button>
      </DialogFooter>
    </div>
  );
}
