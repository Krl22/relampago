import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Mantiene la pantalla encendida (Screen Wake Lock API) mientras el motorizado
 * tiene la app abierta. Se vuelve a pedir solo al regresar a primer plano.
 */
export function useWakeLock() {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const wantedRef = useRef(false);

  const request = useCallback(async () => {
    if (!supported) return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => setActive(false));
      sentinelRef.current = sentinel;
      setActive(true);
    } catch (e) {
      console.warn("No se pudo activar wake lock:", e);
      setActive(false);
    }
  }, [supported]);

  const release = useCallback(async () => {
    wantedRef.current = false;
    await sentinelRef.current?.release();
    sentinelRef.current = null;
    setActive(false);
  }, []);

  const toggle = useCallback(async () => {
    if (wantedRef.current) {
      await release();
    } else {
      wantedRef.current = true;
      await request();
    }
  }, [release, request]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && wantedRef.current && !sentinelRef.current) {
        void request();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void sentinelRef.current?.release();
    };
  }, [request]);

  return { supported, active, toggle };
}
