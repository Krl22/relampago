import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabase";
import { distanceMeters, type LatLng } from "../lib/geo";
import { useAuth } from "./AuthProvider";
import { actsAsCourier } from "../lib/profiles";
import { getImpersonation } from "../lib/impersonation";

export type TrackingStatus =
  | "off" // no aplica (no es motorizado)
  | "prompt" // falta pedir el permiso: hace falta que el usuario toque "Activar ubicación"
  | "requesting" // pidiendo permiso / primera lectura
  | "active"
  | "denied"
  | "unavailable"
  | "error";

interface CourierTrackingContextType {
  status: TrackingStatus;
  /** Última posición conocida del dispositivo (aunque aún no se haya enviado). */
  position: LatLng | null;
  lastSentAt: Date | null;
  error: string | null;
  /** Envía la posición actual ya mismo (antes de cambiar el estado de un pedido). */
  flush: () => Promise<LatLng | null>;
  /** Pide el permiso de ubicación. Llamar desde un gesto del usuario (botón). */
  requestPermission: () => Promise<void>;
}

const CourierTrackingContext = createContext<CourierTrackingContextType>({
  status: "off",
  position: null,
  lastSentAt: null,
  error: null,
  flush: async () => null,
  requestPermission: async () => {},
});

export const useCourierTracking = () => useContext(CourierTrackingContext);

// Ritmo de envío: como mucho una escritura cada SEND_INTERVAL_MS; si no se movió
// más de MIN_MOVE_M, igual se manda un latido cada HEARTBEAT_MS para seguir "en línea".
const SEND_INTERVAL_MS = 20_000;
const HEARTBEAT_MS = 60_000;
const MIN_MOVE_M = 10;

// Recuerda que el motorizado ya aceptó el permiso, para navegadores sin Permissions API.
const GRANTED_KEY = "relampago.location.granted";

function readGrantedFlag(): boolean {
  try {
    return localStorage.getItem(GRANTED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeGrantedFlag(value: boolean) {
  try {
    if (value) localStorage.setItem(GRANTED_KEY, "1");
    else localStorage.removeItem(GRANTED_KEY);
  } catch {
    /* almacenamiento bloqueado: se vuelve a preguntar la próxima vez */
  }
}

export function CourierTrackingProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  // En "Ver como" no se reporta ubicación: sería la del equipo del admin y taparía la real del motorizado
  const enabled = actsAsCourier(profile) && !getImpersonation();

  const [status, setStatus] = useState<TrackingStatus>("off");
  const [armed, setArmed] = useState(false); // true = correr watchPosition
  const [position, setPosition] = useState<LatLng | null>(null);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestRef = useRef<GeolocationPosition | null>(null);
  const lastSentRef = useRef<(LatLng & { time: number }) | null>(null);
  const sendingRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;

  const send = useCallback(async (pos: GeolocationPosition, force = false): Promise<LatLng | null> => {
    const userId = userIdRef.current;
    if (!userId) return null;

    const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const now = Date.now();
    const last = lastSentRef.current;

    if (!force && last) {
      const elapsed = now - last.time;
      if (elapsed < SEND_INTERVAL_MS) return last;
      if (elapsed < HEARTBEAT_MS && distanceMeters(last, point) < MIN_MOVE_M) return last;
    }
    if (sendingRef.current) return last;

    sendingRef.current = true;
    try {
      const { error: upsertError } = await supabase.from("courier_locations").upsert(
        {
          courier_id: userId,
          lat: point.lat,
          lng: point.lng,
          accuracy: pos.coords.accuracy ?? null,
          heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
          speed: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
          recorded_at: new Date(now).toISOString(),
        },
        { onConflict: "courier_id" },
      );
      if (upsertError) throw upsertError;

      lastSentRef.current = { ...point, time: now };
      setLastSentAt(new Date(now));
      setError(null);
      return point;
    } catch (e) {
      console.error("Error enviando ubicación:", e);
      setError((e as Error).message);
      return null;
    } finally {
      sendingRef.current = false;
    }
  }, []);

  // 1) Decidir el estado inicial según el permiso, sin disparar el prompt solos:
  //    Chrome en Android trata mal los prompts que no vienen de un toque del usuario.
  useEffect(() => {
    if (!enabled || !user) {
      setStatus("off");
      setArmed(false);
      return;
    }
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }

    let cancelled = false;
    let permission: PermissionStatus | null = null;

    const apply = (state: PermissionState | "unknown") => {
      if (cancelled) return;
      if (state === "granted") {
        setArmed(true);
      } else if (state === "denied") {
        writeGrantedFlag(false);
        setArmed(false);
        setStatus("denied");
      } else {
        setArmed(false);
        setStatus("prompt");
      }
    };

    const fallback = () => apply(readGrantedFlag() ? "granted" : "unknown");

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((ps) => {
          if (cancelled) return;
          permission = ps;
          apply(ps.state);
          // Si el motorizado lo desbloquea en ajustes, arrancamos solos.
          ps.onchange = () => apply(ps.state);
        })
        .catch(fallback);
    } else {
      fallback();
    }

    return () => {
      cancelled = true;
      if (permission) permission.onchange = null;
    };
  }, [enabled, user]);

  // 2) Seguimiento continuo mientras esté "armado"
  useEffect(() => {
    if (!armed) return;

    setStatus("requesting");

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        latestRef.current = pos;
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("active");
        void send(pos);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          writeGrantedFlag(false);
          setArmed(false);
          setStatus("denied");
        } else {
          setStatus("error");
        }
        setError(err.message);
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );

    // watchPosition solo dispara cuando cambia la posición; el latido cubre al motorizado parado.
    const heartbeat = setInterval(() => {
      if (latestRef.current) void send(latestRef.current);
    }, 10_000);

    // Al volver a primer plano (Android pausa la pestaña), mandar la posición enseguida.
    const onVisible = () => {
      if (document.visibilityState === "visible" && latestRef.current) {
        void send(latestRef.current, true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [armed, send]);

  const requestPermission = useCallback(async () => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    setStatus("requesting");
    setError(null);
    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          latestRef.current = pos;
          setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          writeGrantedFlag(true);
          setArmed(true);
          void send(pos, true);
          resolve();
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            writeGrantedFlag(false);
            setStatus("denied");
          } else {
            // Sin señal GPS todavía, pero el permiso está: dejamos el watch trabajando.
            writeGrantedFlag(true);
            setArmed(true);
            setStatus("error");
          }
          setError(err.message);
          resolve();
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
    });
  }, [send]);

  const flush = useCallback(async (): Promise<LatLng | null> => {
    if (!enabled || !armed || !("geolocation" in navigator)) return null;

    const fresh = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 5_000 },
      );
    });

    const pos = fresh ?? latestRef.current;
    if (!pos) return null;
    if (fresh) {
      latestRef.current = fresh;
      setPosition({ lat: fresh.coords.latitude, lng: fresh.coords.longitude });
    }
    return send(pos, true);
  }, [enabled, armed, send]);

  return (
    <CourierTrackingContext.Provider
      value={{ status, position, lastSentAt, error, flush, requestPermission }}
    >
      {children}
    </CourierTrackingContext.Provider>
  );
}
