import { createFileRoute, redirect } from "@tanstack/react-router";
import { auth } from "@/lib/auth-store";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (auth.isAuthenticated) throw redirect({ to: "/overview" });
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
