import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_cloud/devices")({
  component: () => <Outlet />,
});
