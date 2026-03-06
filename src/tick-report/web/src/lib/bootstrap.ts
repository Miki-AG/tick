import type { UiMode } from "@/lib/types";

export interface BootstrapConfig {
  mode: UiMode;
  pollMs: number;
  selectedProjectId: string | null;
  projectId: string | null;
  projectPath: string | null;
  ticketId: string | null;
}

type ReportConfig = {
  mode?: "landing" | "project";
  pollMs?: number;
  selectedProjectId?: string | null;
};

type TicketConfig = {
  pollMs?: number;
  projectId?: string | null;
  projectPath?: string | null;
  ticketId?: string | null;
};

declare global {
  interface Window {
    __TICK_REPORT_CONFIG?: ReportConfig;
    __TICK_TICKET_CONFIG?: TicketConfig;
    __TICK_REPORT_BOOTSTRAP__?: Partial<BootstrapConfig>;
  }
}

const DEFAULT_POLL_MS = 5000;

function inferFromPathname(pathname: string): Partial<BootstrapConfig> {
  const parts = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (parts.length === 4 && parts[0] === "project" && parts[2] === "ticket") {
    return {
      mode: "ticket",
      projectId: decodeURIComponent(parts[1]),
      ticketId: decodeURIComponent(parts[3]),
    };
  }

  if (parts.length === 2 && parts[0] === "project") {
    return {
      mode: "project",
      selectedProjectId: decodeURIComponent(parts[1]),
      projectId: decodeURIComponent(parts[1]),
    };
  }

  return {
    mode: "landing",
  };
}

function normalizePollMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 250) {
    return DEFAULT_POLL_MS;
  }
  return parsed;
}

function normalizeNullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

export function readBootstrapConfig(): BootstrapConfig {
  const explicit = window.__TICK_REPORT_BOOTSTRAP__ || {};
  const report = window.__TICK_REPORT_CONFIG || {};
  const ticket = window.__TICK_TICKET_CONFIG || {};
  const inferred = inferFromPathname(window.location.pathname);

  const mode =
    explicit.mode ||
    (ticket.ticketId ? "ticket" : null) ||
    report.mode ||
    inferred.mode ||
    "landing";

  const projectId =
    normalizeNullableText(explicit.projectId) ||
    normalizeNullableText(ticket.projectId) ||
    normalizeNullableText(explicit.selectedProjectId) ||
    normalizeNullableText(report.selectedProjectId) ||
    normalizeNullableText(inferred.projectId);

  return {
    mode,
    pollMs: normalizePollMs(explicit.pollMs ?? report.pollMs ?? ticket.pollMs),
    selectedProjectId:
      normalizeNullableText(explicit.selectedProjectId) ||
      normalizeNullableText(report.selectedProjectId) ||
      normalizeNullableText(inferred.selectedProjectId) ||
      projectId,
    projectId,
    projectPath:
      normalizeNullableText(explicit.projectPath) || normalizeNullableText(ticket.projectPath),
    ticketId:
      normalizeNullableText(explicit.ticketId) ||
      normalizeNullableText(ticket.ticketId) ||
      normalizeNullableText(inferred.ticketId),
  };
}
