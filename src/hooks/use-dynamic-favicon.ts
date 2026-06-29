import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listDevices } from "@/lib/cloud.functions";
import { listDeviceEvents } from "@/lib/control.functions";

type PumpStatus = "idle" | "active" | "paused" | "error";

export function useDynamicFavicon() {
  const fetchDevices = useServerFn(listDevices);
  const fetchEvents = useServerFn(listDeviceEvents);

  const { data: devices = [] } = useQuery({
    queryKey: ["devices"],
    queryFn: () => fetchDevices(),
    refetchInterval: 60000,
  });

  const paired = devices.filter((d: any) => d.paired);
  const activeId = paired[0]?.id;

  const { data: events = [] } = useQuery({
    queryKey: ["pump-events", activeId],
    queryFn: () => fetchEvents({ data: { deviceId: activeId, limit: 1 } }),
    refetchInterval: 15000,
    enabled: !!activeId,
  });

  useEffect(() => {
    if (!activeId) {
      updateFavicon("idle");
      return;
    }

    const lastEvent = events[0] as any;
    if (!lastEvent) {
      updateFavicon("idle");
      return;
    }

    let status: PumpStatus = "idle";

    // Determine status based on last event
    const metrics = lastEvent.metrics || {};
    const watts = metrics.watts ?? metrics.watt ?? metrics.house_power;

    if (lastEvent.status === "critical" || lastEvent.status === "error") {
      status = "error";
    } else if (watts > 10) {
      status = "active";
    } else if (lastEvent.message?.toLowerCase().includes("pause") ||
               lastEvent.strategy_applied?.toLowerCase().includes("pause")) {
      status = "paused";
    }

    updateFavicon(status);
  }, [events, activeId]);

  function updateFavicon(status: PumpStatus) {
    const favicon = document.getElementById("favicon") as HTMLLinkElement;
    if (favicon) {
      favicon.href = `/icons/pump-${status}.svg`;
    }
  }
}
