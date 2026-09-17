import { createFileRoute, redirect } from "@tanstack/react-router";

// Plugins were replaced by self-announced Node-RED endpoints.
export const Route = createFileRoute("/plugins")({
  beforeLoad: () => {
    throw redirect({ to: "/control" });
  },
  component: () => null,
});
