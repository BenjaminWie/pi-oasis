import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listDevices } from "@/lib/cloud.functions";

type PumpStatus = "idle" | "active" | "paused" | "error";

export function useDynamicFavicon() {
  const fetchDevices = useServerFn(listDevices);

  const { data: devices = [] } = useQuery({
    queryKey: ["devices"],
    queryFn: () => fetchDevices(),
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });

  const paired = devices.filter((d: any) => d.paired);
  const activeId = paired[0]?.id;

  const [tick, setTick] = useState<any>(null);

  // Live broadcast: NO database poll. Falls back to "idle" if no ticks yet.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let channel: any = null;
    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      if (cancelled) return;
      channel = supabase
        .channel(`live:${activeId}`)
        .on("broadcast", { event: "tick" }, ({ payload }) => setTick(payload))
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) {
        import("@/integrations/supabase/client").then(({ supabase }) => {
          supabase.removeChannel(channel);
        });
      }
    };
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return updateFavicon("idle");
    if (!tick) return updateFavicon("idle");
    let status: PumpStatus = "idle";
    if (tick.pump_on === true || (typeof tick.watts === "number" && tick.watts > 10)) {
      status = "active";
    } else if (tick.strategy_applied?.toString().toLowerCase().includes("pause")) {
      status = "paused";
    }
    updateFavicon(status);
  }, [tick, activeId]);

  function updateFavicon(status: PumpStatus) {
    const favicon = document.getElementById("favicon") as HTMLLinkElement;
    if (favicon) {
      favicon.href = `/icons/pump-${status}.svg`;
    }
  }
}
