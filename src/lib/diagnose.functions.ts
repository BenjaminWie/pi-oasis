import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "@/lib/pi-auth-middleware";

/** Recent debug lines as plain text for the Diagnose textarea. */
export const collectDiagnosticsFn = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { debugEntries } = await import("@/lib/registry.server");
    const lines = debugEntries(120)
      .filter((e) => e.dir === "error" || e.dir === "info")
      .reverse()
      .map(
        (e) =>
          `${e.ts} [${e.channel}] ${e.dir.toUpperCase()} ${e.what}${
            e.detail !== undefined ? " " + JSON.stringify(e.detail).slice(0, 300) : ""
          }${e.ms != null ? ` (${e.ms} ms)` : ""}`,
      );
    return { text: lines.join("\n"), count: lines.length };
  });
