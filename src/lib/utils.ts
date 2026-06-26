import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isSlimMode() {
  if (typeof window !== "undefined") {
    // On the client, look for the data attribute we set on the html tag during SSR.
    // This is the most reliable way to sync SSR state to the client.
    return document.documentElement.getAttribute("data-slim") === "true";
  }
  // On the server, check process.env or the global we injected in server.ts
  const val = (globalThis as any).VITE_PI_SLIM_MODE || (typeof process !== "undefined" ? process.env.VITE_PI_SLIM_MODE : undefined);
  return val === "true" || val === true;
}
