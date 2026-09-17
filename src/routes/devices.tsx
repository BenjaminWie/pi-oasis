import { createFileRoute, redirect } from "@tanstack/react-router";

// Device pairing is gone: the cloud only routes commands to the Pi relay.
export const Route = createFileRoute("/devices")({
  beforeLoad: () => {
    throw redirect({ to: "/connections/setup" });
  },
  component: () => null,
});
