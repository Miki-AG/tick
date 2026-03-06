import { useCallback, useEffect, useMemo, useState } from "react";

import { detachProject, getProjects } from "@/lib/api";
import type { BootstrapConfig } from "@/lib/bootstrap";
import type { ProjectSummary } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface LandingPageProps {
  config: BootstrapConfig;
}

function projectStatus(project: ProjectSummary): { label: string; variant: "success" | "warning" | "danger" } {
  if (!project.available) {
    return { label: "unavailable", variant: "danger" };
  }
  if (!project.tickEnabled) {
    return { label: "no _ISSUES", variant: "warning" };
  }
  return { label: "ok", variant: "success" };
}

export function LandingPage({ config }: LandingPageProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [statusMessage, setStatusMessage] = useState("loading...");
  const [lastRefreshText, setLastRefreshText] = useState("last refresh: -");

  const projectCount = projects.length;

  const refreshLanding = useCallback(async () => {
    const data = await getProjects();
    const loadedProjects = Array.isArray(data.projects) ? data.projects : [];
    setProjects(loadedProjects);
    setStatusMessage(`Attached projects: ${loadedProjects.length}`);
    setLastRefreshText(`last refresh: ${new Date().toLocaleTimeString()}`);
  }, []);

  const handleDetach = useCallback(async (projectId: string) => {
    setStatusMessage(`Detaching project ${projectId}...`);
    const data = await detachProject(projectId);
    const loadedProjects = Array.isArray(data.projects) ? data.projects : [];
    setProjects(loadedProjects);
    setStatusMessage(`Attached projects: ${loadedProjects.length}`);
    setLastRefreshText(`last refresh: ${new Date().toLocaleTimeString()}`);
  }, []);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        await refreshLanding();
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "Unable to load tick-report data.";
        setStatusMessage(`Unable to load tick-report data: ${message}`);
      }
    }

    run();
    const interval = window.setInterval(() => {
      run();
    }, config.pollMs);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [config.pollMs, refreshLanding]);

  const rows = useMemo(
    () =>
      projects.map((project) => {
        const status = projectStatus(project);
        return (
          <TableRow key={project.id}>
            <TableCell>{project.name || project.id}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{project.path || ""}</TableCell>
            <TableCell>
              <Badge variant={status.variant}>{status.label}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Button asChild size="sm">
                  <a href={`/project/${encodeURIComponent(project.id)}`}>GO</a>
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleDetach(project.id)}>
                  DETACH
                </Button>
              </div>
            </TableCell>
          </TableRow>
        );
      }),
    [handleDetach, projects]
  );

  const mobileCards = useMemo(
    () =>
      projects.map((project) => {
        const status = projectStatus(project);
        return (
          <div className="rounded-lg border border-border/70 bg-card/60 p-3" key={`mobile-${project.id}`}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{project.name || project.id}</div>
                <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{project.path || ""}</div>
              </div>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild className="h-8 flex-1 text-xs" size="sm">
                <a href={`/project/${encodeURIComponent(project.id)}`}>GO</a>
              </Button>
              <Button
                className="h-8 flex-1 text-xs"
                size="sm"
                variant="secondary"
                onClick={() => handleDetach(project.id)}
              >
                DETACH
              </Button>
            </div>
          </div>
        );
      }),
    [handleDetach, projects]
  );

  return (
    <main className="min-h-screen bg-background px-3 py-5 text-foreground sm:px-4 sm:py-8">
      <div className="mx-auto w-full max-w-[1400px]">
        <PageHeader
          intervalMs={config.pollMs}
          project={null}
          activeProjectPath="-"
          lastRefreshText={lastRefreshText}
        />

        <Card>
          <CardHeader>
            <CardTitle>Attached Projects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert id="tick-status">{statusMessage}</Alert>

            <div
              className={projectCount === 0 ? "text-sm text-muted-foreground" : "hidden"}
              id="projects-empty"
            >
              No attached projects.
            </div>

            {projectCount > 0 ? <div className="space-y-3 md:hidden">{mobileCards}</div> : null}

            <div className="hidden md:block">
              <Table className="projects-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>project</TableHead>
                    <TableHead>path</TableHead>
                    <TableHead>status</TableHead>
                    <TableHead>actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody id="project-rows">{rows}</TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
