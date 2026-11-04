import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "@/landing/LandingPage";

export const Route = createFileRoute("/login")({
  component: LandingPage,
});
