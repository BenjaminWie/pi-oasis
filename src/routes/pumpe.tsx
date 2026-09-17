import { createFileRoute, redirect } from "@tanstack/react-router";

// Old local pump page — the pump is now one endpoint among many.
export const Route = createFileRoute("/pumpe")({
  beforeLoad: () => {
    throw redirect({ to: "/control" });
  },
  component: () => null,
});
