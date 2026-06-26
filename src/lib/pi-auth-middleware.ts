// Server-fn middleware that requires a valid Pi dashboard token in the
// `X-Pi-Auth` header. The token is issued by `verifyPin` after a successful
// PIN check and stored client-side in localStorage; `attachPiAuth` adds it
// to outgoing server-fn calls automatically.
import { createMiddleware } from "@tanstack/react-start";

export const requirePiAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  const { verifyPiToken } = await import("./pi-auth.server");
  const token = getRequestHeader("x-pi-auth") || null;
  const { hasProcStats } = await import("./pi-runtime.server");
  // Bypass auth ONLY in dev mode or when NOT on a Pi (preview mode)
  // On a real Pi (production), hasProcStats() is true and we MUST verify the token.
  const isDev = process.env.NODE_ENV === "development";
  const isOnPi = hasProcStats();

  if (isOnPi && !isDev && !verifyPiToken(token)) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return next();
});
