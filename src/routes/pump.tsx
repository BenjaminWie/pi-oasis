import { createFileRoute, redirect } from "@tanstack/react-router";

// Old cloud pump page — the assistant and the local control tab replace it.
export const Route = createFileRoute("/pump")({
  beforeLoad: () => {
    throw redirect({ to: "/connections" });
  },
  component: () => null,
});
