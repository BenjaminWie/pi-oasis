import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isSlimMode() {
  if (typeof window !== "undefined") {
    if (document.documentElement.getAttribute("data-slim") === "true") return true;
    if (document.documentElement.classList.contains("slim-mode")) return true;
    const win = window as any;
    if (win.VITE_PI_SLIM_MODE === "true" || win.VITE_PI_SLIM_MODE === true) return true;
    return false;
  }

  const v =
    (globalThis as any).VITE_PI_SLIM_MODE ??
    (typeof process !== "undefined" ? process.env.VITE_PI_SLIM_MODE : undefined);
  return v === "true" || v === true;
}
