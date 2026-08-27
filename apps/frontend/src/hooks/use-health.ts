import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { HealthResponse } from "@/lib/types";

const POLL_INTERVAL_MS = 20_000;

export function useHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await api.getHealth();
        if (!cancelled) {
          setHealth(result);
          setUnreachable(false);
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
          setUnreachable(true);
        }
      } finally {
        if (!cancelled) {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { health, unreachable };
}
