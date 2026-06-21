// Client-side server-fn middleware that attaches the Pi dashboard token
// (stored in localStorage by `auth.setToken`) as the `X-Pi-Auth` header.
// Safe on SSR — falls through without a header when window is undefined.
import { createMiddleware } from "@tanstack/react-start";

const KEY = "pi-dashboard.token";

export const attachPiAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token =
      typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    return next({ headers: token ? { "X-Pi-Auth": token } : {} });
  },
);
