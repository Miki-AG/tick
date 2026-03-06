import type { ProjectSummary } from "@/lib/types";

interface PageHeaderProps {
  intervalMs: number;
  project: ProjectSummary | null;
  ticketId?: string | null;
  activeProjectPath?: string | null;
  rootDir?: string | null;
  lastRefreshText: string;
  hideMetaOnMobile?: boolean;
}

export function PageHeader({
  intervalMs,
  project,
  ticketId,
  activeProjectPath,
  rootDir,
  lastRefreshText,
  hideMetaOnMobile = false,
}: PageHeaderProps) {
  const hasProject = Boolean(project && project.id);
  const projectLinkId = ticketId ? "ticket-project-link" : "header-project-link";

  return (
    <header className="mb-5 space-y-2 sm:mb-6">
      <h1 className="flex flex-wrap items-center text-xl font-semibold tracking-tight sm:text-2xl">
        <a className="text-foreground hover:text-primary" href="/">
          tick-report
        </a>
        {hasProject ? <span className="px-2 text-muted-foreground">/</span> : null}
        {hasProject ? (
          <a
            className="max-w-full break-all font-mono text-foreground hover:text-primary"
            id={projectLinkId}
            href={`/project/${encodeURIComponent(project!.id)}`}
          >
            {project!.name || project!.id}
          </a>
        ) : null}
        {ticketId ? <span className="px-2 text-muted-foreground">/</span> : null}
        {ticketId ? <span id="ticket-page-title">ticket {ticketId}</span> : null}
      </h1>

      <div
        className={
          hideMetaOnMobile
            ? "hidden flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:text-xs md:flex"
            : "flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:text-xs"
        }
      >
        {!ticketId ? (
          <>
            <span>mode: single global instance</span>
            <span>
              project:{" "}
              <span id="active-project-path" className="break-all font-mono text-foreground">
                {activeProjectPath || "-"}
              </span>
            </span>
          </>
        ) : (
          <>
            <span>
              project:{" "}
              <span id="project-id" className="break-all font-mono text-foreground">
                {project?.id || "-"}
              </span>
            </span>
            <span>
              path:{" "}
              <span id="root-dir" className="break-all font-mono text-foreground">
                {rootDir || project?.path || "-"}
              </span>
            </span>
          </>
        )}
        <span>refresh: {intervalMs}ms</span>
        <span id="last-refresh">{lastRefreshText || "last refresh: -"}</span>
      </div>
    </header>
  );
}
