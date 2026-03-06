import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getProjectConfig, getProjectReport, saveProjectConfig } from "@/lib/api";
import type { BootstrapConfig } from "@/lib/bootstrap";
import { FILTER_STATUSES, formatUpdatedParts, normalizeStatus, ticketHasLabel, toTicketNumber } from "@/lib/format";
import type {
  ProjectSummary,
  TicketColumnKey,
  TicketColumnsByView,
  TicketColumnsConfig,
  TicketStatus,
  TicketSummary,
} from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface ProjectPageProps {
  config: BootstrapConfig;
}

type StatusFilterMap = Record<TicketStatus, boolean>;

const COLUMN_OPTIONS: { key: TicketColumnKey; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "owner", label: "Owner" },
  { key: "labels", label: "Labels" },
  { key: "updated", label: "Updated" },
  { key: "updates", label: "Updates" },
];

function buildDefaultStatusFilters(): StatusFilterMap {
  return {
    open: true,
    doing: true,
    blocked: true,
    done: true,
    wontfix: true,
    parked: true,
  };
}

function buildDefaultDesktopColumns(): TicketColumnsConfig {
  return {
    id: true,
    title: true,
    status: true,
    priority: true,
    owner: true,
    labels: true,
    updated: true,
    updates: true,
  };
}

function buildDefaultMobileColumns(): TicketColumnsConfig {
  return {
    id: true,
    title: true,
    status: true,
    priority: false,
    owner: false,
    labels: false,
    updated: false,
    updates: false,
  };
}

function buildDefaultColumnsByView(): TicketColumnsByView {
  return {
    desktop: buildDefaultDesktopColumns(),
    mobile: buildDefaultMobileColumns(),
  };
}

function normalizeColumnsConfig(
  raw: Partial<TicketColumnsConfig> | undefined,
  defaults: TicketColumnsConfig
): TicketColumnsConfig {
  const source = raw || {};
  return {
    id: typeof source.id === "boolean" ? source.id : defaults.id,
    title: typeof source.title === "boolean" ? source.title : defaults.title,
    status: typeof source.status === "boolean" ? source.status : defaults.status,
    priority: typeof source.priority === "boolean" ? source.priority : defaults.priority,
    owner: typeof source.owner === "boolean" ? source.owner : defaults.owner,
    labels: typeof source.labels === "boolean" ? source.labels : defaults.labels,
    updated: typeof source.updated === "boolean" ? source.updated : defaults.updated,
    updates: typeof source.updates === "boolean" ? source.updates : defaults.updates,
  };
}

function normalizeColumnsByView(
  raw:
    | {
        desktop?: Partial<TicketColumnsConfig>;
        mobile?: Partial<TicketColumnsConfig>;
      }
    | undefined
): TicketColumnsByView {
  return {
    desktop: normalizeColumnsConfig(raw?.desktop, buildDefaultDesktopColumns()),
    mobile: normalizeColumnsConfig(raw?.mobile, buildDefaultMobileColumns()),
  };
}

function countEnabledColumns(columns: TicketColumnsConfig): number {
  return COLUMN_OPTIONS.reduce((count, column) => (columns[column.key] ? count + 1 : count), 0);
}

function getPrefsKey(projectId: string | null): string {
  return `tick-report:prefs:project:${projectId || "default"}`;
}

function statusVariant(
  status: TicketStatus
): "secondary" | "outline" | "warning" | "success" | "danger" | "muted" {
  if (status === "open") return "outline";
  if (status === "doing") return "warning";
  if (status === "blocked") return "danger";
  if (status === "done") return "success";
  if (status === "wontfix") return "muted";
  return "secondary";
}

function statusToggleClasses(status: TicketStatus, active: boolean): string {
  if (!active) {
    return "bg-background text-muted-foreground hover:bg-muted/50";
  }

  if (status === "doing") return "bg-amber-500/20 text-amber-200";
  if (status === "blocked") return "bg-rose-500/20 text-rose-200";
  if (status === "done") return "bg-emerald-500/20 text-emerald-200";
  if (status === "wontfix") return "bg-zinc-500/25 text-zinc-200";
  if (status === "parked") return "bg-muted text-foreground";
  return "bg-slate-500/25 text-slate-100";
}

export function ProjectPage({ config }: ProjectPageProps) {
  const selectedProjectId = config.selectedProjectId;

  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [statusMessage, setStatusMessage] = useState("loading...");
  const [lastRefreshText, setLastRefreshText] = useState("last refresh: -");
  const [statusFilters, setStatusFilters] = useState<StatusFilterMap>(buildDefaultStatusFilters);
  const [minTicketId, setMinTicketId] = useState<number | null>(null);
  const [labelFilter, setLabelFilter] = useState("");
  const [isMobileChromeVisible, setIsMobileChromeVisible] = useState(false);
  const [columnConfigByView, setColumnConfigByView] = useState<TicketColumnsByView>(
    buildDefaultColumnsByView
  );
  const [isColumnPopupOpen, setIsColumnPopupOpen] = useState(false);

  const columnPopupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(getPrefsKey(selectedProjectId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;

      const next = buildDefaultStatusFilters();
      if (parsed.statusFilters && typeof parsed.statusFilters === "object") {
        for (const status of FILTER_STATUSES) {
          if (typeof parsed.statusFilters[status] === "boolean") {
            next[status] = parsed.statusFilters[status];
          }
        }
      }
      setStatusFilters(next);

      if (Number.isFinite(parsed.minTicketId) && parsed.minTicketId >= 0) {
        setMinTicketId(parsed.minTicketId);
      }
      if (typeof parsed.labelFilter === "string") {
        setLabelFilter(parsed.labelFilter);
      }
    } catch (_err) {
      // Ignore malformed local preference payloads.
    }
  }, [selectedProjectId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        getPrefsKey(selectedProjectId),
        JSON.stringify({ statusFilters, minTicketId, labelFilter })
      );
    } catch (_err) {
      // Ignore local storage write failures.
    }
  }, [labelFilter, minTicketId, selectedProjectId, statusFilters]);

  useEffect(() => {
    let cancelled = false;

    async function loadColumns() {
      if (!selectedProjectId) {
        setColumnConfigByView(buildDefaultColumnsByView());
        return;
      }
      try {
        const payload = await getProjectConfig(selectedProjectId);
        if (cancelled) return;
        const normalized = normalizeColumnsByView(payload.config?.columns);
        setColumnConfigByView(normalized);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unable to load column settings.";
        setStatusMessage(`Unable to load column settings: ${message}`);
      }
    }

    void loadColumns();

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const persistColumns = useCallback(
    async (target: "desktop" | "mobile", nextColumns: TicketColumnsConfig) => {
      if (!selectedProjectId) return;
      const payload = await saveProjectConfig(selectedProjectId, {
        columns: {
          [target]: nextColumns,
        },
      });
      setColumnConfigByView(normalizeColumnsByView(payload.config?.columns));
    },
    [selectedProjectId]
  );

  useEffect(() => {
    if (!isColumnPopupOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!columnPopupRef.current) return;
      if (columnPopupRef.current.contains(event.target as Node)) return;
      setIsColumnPopupOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsColumnPopupOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isColumnPopupOpen]);

  const refreshProject = useCallback(async () => {
    if (!selectedProjectId) {
      setProject(null);
      setTickets([]);
      setStatusMessage("Project not found.");
      setLastRefreshText(`last refresh: ${new Date().toLocaleTimeString()}`);
      return;
    }

    const data = await getProjectReport(selectedProjectId);
    const loadedTickets = Array.isArray(data.tickets) ? data.tickets : [];
    const loadedProject = data.project || null;

    setProject(loadedProject);
    setTickets(loadedTickets);

    const visibleCount = loadedTickets.filter((ticket) => {
      if (!statusFilters[normalizeStatus(ticket.status)]) return false;
      if (!ticketHasLabel(ticket, labelFilter)) return false;
      if (minTicketId === null) return true;
      const idNum = toTicketNumber(ticket.id || ticket.fileId);
      return idNum !== null && idNum >= minTicketId;
    }).length;

    const popupMessage = data.popup?.message ? ` | popup: ${data.popup.message}` : "";
    const projectLabel = loadedProject?.path || selectedProjectId;
    setStatusMessage(
      `Project: ${projectLabel} | tickets: ${visibleCount}/${loadedTickets.length}${popupMessage}`
    );
    setLastRefreshText(`last refresh: ${new Date().toLocaleTimeString()}`);
  }, [labelFilter, minTicketId, selectedProjectId, statusFilters]);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        await refreshProject();
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "Unable to load tick-report data.";
        setStatusMessage(`Unable to load tick-report data: ${message}`);
      }
    }

    run();
    const interval = window.setInterval(run, config.pollMs);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [config.pollMs, refreshProject]);

  const visibleTickets = useMemo(
    () =>
      tickets.filter((ticket) => {
        if (!statusFilters[normalizeStatus(ticket.status)]) return false;
        if (!ticketHasLabel(ticket, labelFilter)) return false;
        if (minTicketId === null) return true;
        const idNum = toTicketNumber(ticket.id || ticket.fileId);
        return idNum !== null && idNum >= minTicketId;
      }),
    [labelFilter, minTicketId, statusFilters, tickets]
  );

  const visibleColumnCount = useMemo(
    () => Math.max(1, countEnabledColumns(columnConfigByView.desktop)),
    [columnConfigByView.desktop]
  );

  const mobileTicketCards = useMemo(
    () =>
      visibleTickets.map((ticket) => {
        const status = normalizeStatus(ticket.status);
        const ticketId = String(ticket.fileId || ticket.id || "").trim();

        return (
          <div
            className="rounded-lg border border-border/70 bg-card/60 px-2 py-2"
            key={`mobile-${ticket.fileName || ticketId || ticket.title}`}
          >
            <div className="grid grid-cols-[3.25rem_1fr_auto] items-start gap-x-2">
              <div className="font-mono text-xs text-foreground">{ticket.id || ticket.fileId || ""}</div>
              <a
                className="ticket-link text-xs text-primary hover:underline break-words [overflow-wrap:anywhere]"
                href={`/project/${encodeURIComponent(selectedProjectId || "")}/ticket/${encodeURIComponent(ticketId)}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                {ticket.title || "(untitled)"}
              </a>
              <Badge className={cn("w-fit", status === "doing" ? "status-doing-pulse" : "")} variant={statusVariant(status)}>
                {status}
              </Badge>
            </div>
          </div>
        );
      }),
    [selectedProjectId, visibleTickets]
  );

  const onToggleColumn = useCallback(
    (target: "desktop" | "mobile", columnKey: TicketColumnKey) => {
      setColumnConfigByView((current) => {
        const currentTargetColumns = current[target];
        const enabledCount = countEnabledColumns(currentTargetColumns);
        if (currentTargetColumns[columnKey] && enabledCount === 1) {
          setStatusMessage("At least one column must remain visible.");
          return current;
        }

        const nextTargetColumns = {
          ...currentTargetColumns,
          [columnKey]: !currentTargetColumns[columnKey],
        };
        const next = {
          ...current,
          [target]: nextTargetColumns,
        };

        void persistColumns(target, nextTargetColumns).catch((err) => {
          const message = err instanceof Error ? err.message : "Unable to save column settings.";
          setStatusMessage(`Unable to save column settings: ${message}`);
          setColumnConfigByView(current);
        });

        return next;
      });
    },
    [persistColumns]
  );

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto w-full max-w-[1440px]">
        <PageHeader
          intervalMs={config.pollMs}
          project={project}
          activeProjectPath={project?.path || "-"}
          lastRefreshText={lastRefreshText}
          hideMetaOnMobile={!isMobileChromeVisible}
        />

        <div className="mb-3 flex justify-end md:hidden">
          <button
            className="h-7 rounded-md border border-border bg-background px-2 text-[10px] font-semibold uppercase tracking-wide text-foreground hover:bg-muted/50"
            type="button"
            onClick={() => setIsMobileChromeVisible((current) => !current)}
          >
            {isMobileChromeVisible ? "Hide Controls" : "Show Controls"}
          </button>
        </div>

        <div
          className={cn(
            "mb-4 md:rounded-xl md:border md:bg-card md:text-card-foreground md:shadow",
            isMobileChromeVisible ? "block" : "hidden md:block"
          )}
        >
          <div className="space-y-4 p-0 md:p-6 md:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-muted-foreground">Ticket filters</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Show</span>
                <div className="inline-flex overflow-hidden rounded-md border border-border" id="status-filters">
                  {FILTER_STATUSES.map((status) => (
                    <button
                      key={status}
                      className={cn(
                        `filter-btn status-${status} h-7 border-l border-border px-2 text-[10px] font-semibold uppercase tracking-wide transition-colors first:border-l-0`,
                        statusToggleClasses(status, statusFilters[status])
                      )}
                      type="button"
                      onClick={() => {
                        setStatusFilters((current) => ({
                          ...current,
                          [status]: !current[status],
                        }));
                      }}
                    >
                      {status}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground" htmlFor="label-filter-input">
                    Label
                  </label>
                  <Input
                    id="label-filter-input"
                    className="h-9 w-40"
                    placeholder="e.g. BUG"
                    value={labelFilter}
                    onChange={(event) => setLabelFilter(event.currentTarget.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground" htmlFor="min-ticket-id">
                    Min ticket
                  </label>
                  <Input
                    id="min-ticket-id"
                    className="h-9 w-28"
                    min={0}
                    placeholder="e.g. 42"
                    step={1}
                    type="number"
                    value={minTicketId === null ? "" : String(minTicketId)}
                    onChange={(event) => {
                      const raw = event.currentTarget.value.trim();
                      if (!raw) {
                        setMinTicketId(null);
                        return;
                      }
                      const parsed = Number.parseInt(raw, 10);
                      setMinTicketId(Number.isFinite(parsed) && parsed >= 0 ? parsed : null);
                    }}
                  />
                </div>

                <div className="relative" ref={columnPopupRef}>
                  <button
                    className="h-7 rounded-md border border-border bg-background px-2 text-[10px] font-semibold uppercase tracking-wide text-foreground hover:bg-muted/50"
                    type="button"
                    onClick={() => setIsColumnPopupOpen((current) => !current)}
                  >
                    Columns
                  </button>
                  {isColumnPopupOpen ? (
                    <div className="absolute right-0 z-30 mt-2 w-56 rounded-md border border-border bg-popover p-2 shadow-lg">
                      <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Columns
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 border-b border-border/70 px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span>Field</span>
                        <span className="justify-self-center">Desktop</span>
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {COLUMN_OPTIONS.map((column) => (
                          <div
                            className="grid grid-cols-[1fr_auto] items-center gap-x-2 rounded px-1 py-1 text-xs hover:bg-muted/40"
                            key={`column-${column.key}`}
                          >
                            <span>{column.label}</span>
                            <input
                              checked={columnConfigByView.desktop[column.key]}
                              className="h-3.5 w-3.5 justify-self-center"
                              type="checkbox"
                              onChange={() => onToggleColumn("desktop", column.key)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <Alert id="tick-status">{statusMessage}</Alert>
          </div>
        </div>

        <div className="space-y-3 md:hidden">
          {mobileTicketCards.length > 0 ? (
            mobileTicketCards
          ) : (
            <div className="text-sm text-muted-foreground">
              {tickets.length > 0 ? "No tickets match current filters." : "No tickets found in selected project."}
            </div>
          )}
        </div>

        <Card className="hidden md:block">
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  {columnConfigByView.desktop.id ? <TableHead>id</TableHead> : null}
                  {columnConfigByView.desktop.title ? <TableHead>title</TableHead> : null}
                  {columnConfigByView.desktop.status ? <TableHead>status</TableHead> : null}
                  {columnConfigByView.desktop.priority ? <TableHead>priority</TableHead> : null}
                  {columnConfigByView.desktop.owner ? <TableHead>owner</TableHead> : null}
                  {columnConfigByView.desktop.labels ? <TableHead>labels</TableHead> : null}
                  {columnConfigByView.desktop.updated ? <TableHead>updated</TableHead> : null}
                  {columnConfigByView.desktop.updates ? <TableHead>updates</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody id="rows">
                {visibleTickets.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={visibleColumnCount}>
                      {tickets.length > 0
                        ? "No tickets match current filters."
                        : "No tickets found in selected project."}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleTickets.map((ticket) => {
                    const status = normalizeStatus(ticket.status);
                    const updated = formatUpdatedParts(ticket);
                    const ticketId = String(ticket.fileId || ticket.id || "").trim();

                    return (
                      <TableRow key={`${ticket.fileName || ticketId || ticket.title}`}>
                        {columnConfigByView.desktop.id ? <TableCell>{ticket.id || ticket.fileId || ""}</TableCell> : null}
                        {columnConfigByView.desktop.title ? (
                          <TableCell>
                            <a
                              className="ticket-link text-primary hover:underline"
                              href={`/project/${encodeURIComponent(selectedProjectId || "")}/ticket/${encodeURIComponent(ticketId)}`}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              {ticket.title || "(untitled)"}
                            </a>
                          </TableCell>
                        ) : null}
                        {columnConfigByView.desktop.status ? (
                          <TableCell>
                            <Badge className={status === "doing" ? "status-doing-pulse" : ""} variant={statusVariant(status)}>
                              {status}
                            </Badge>
                          </TableCell>
                        ) : null}
                        {columnConfigByView.desktop.priority ? <TableCell>{ticket.priority || ""}</TableCell> : null}
                        {columnConfigByView.desktop.owner ? <TableCell>{ticket.owner || ""}</TableCell> : null}
                        {columnConfigByView.desktop.labels ? <TableCell>{ticket.labels || ""}</TableCell> : null}
                        {columnConfigByView.desktop.updated ? (
                          <TableCell>
                            <div className="flex flex-col text-xs">
                              <span>{updated.date || ""}</span>
                              <span className="text-muted-foreground">{updated.time || ""}</span>
                            </div>
                          </TableCell>
                        ) : null}
                        {columnConfigByView.desktop.updates ? (
                          <TableCell className="max-w-[360px] whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            {String(ticket.updates || "").trim()}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
