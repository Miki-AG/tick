import { useMemo } from "react";

import { readBootstrapConfig } from "@/lib/bootstrap";
import { LandingPage } from "@/pages/landing-page";
import { ProjectPage } from "@/pages/project-page";
import { TicketPage } from "@/pages/ticket-page";

export default function App() {
  const config = useMemo(() => readBootstrapConfig(), []);

  if (config.mode === "ticket") {
    return <TicketPage config={config} />;
  }

  if (config.mode === "project") {
    return <ProjectPage config={config} />;
  }

  return <LandingPage config={config} />;
}
