export type UiMode = "landing" | "project" | "ticket";

export type TicketStatus = "open" | "doing" | "blocked" | "done" | "wontfix" | "parked";
export type TicketColumnKey =
  | "id"
  | "title"
  | "status"
  | "priority"
  | "owner"
  | "labels"
  | "updated"
  | "updates";

export type TicketColumnsConfig = Record<TicketColumnKey, boolean>;
export type TicketColumnsByView = {
  desktop: TicketColumnsConfig;
  mobile: TicketColumnsConfig;
};

export interface PopupPayload {
  level?: "info" | "warn" | "error";
  message?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  available: boolean;
  tickEnabled: boolean;
  attachedAt?: string;
  lastAttachedAt?: string;
}

export interface TicketSummary {
  id?: string;
  fileId?: string;
  fileName?: string;
  title?: string;
  status?: string;
  priority?: string;
  owner?: string;
  labels?: string;
  updated?: string;
  updatedAt?: string;
  updates?: string;
  body?: string;
}

export interface ProjectsResponse {
  generatedAt?: string;
  selectedProjectId?: string | null;
  projects?: ProjectSummary[];
  error?: string;
}

export interface ProjectReportResponse {
  generatedAt?: string;
  project?: ProjectSummary;
  rootDir?: string;
  tickEnabled?: boolean;
  tickets?: TicketSummary[];
  popup?: PopupPayload | null;
  error?: string;
}

export interface TicketResponse {
  generatedAt?: string;
  project?: ProjectSummary;
  rootDir?: string;
  tickEnabled?: boolean;
  ticket?: TicketSummary | null;
  popup?: PopupPayload | null;
  error?: string;
}

export interface AttachProjectResponse {
  generatedAt?: string;
  attached?: ProjectSummary;
  added?: boolean;
  error?: string;
}

export interface DetachProjectResponse {
  generatedAt?: string;
  detached?: ProjectSummary;
  projects?: ProjectSummary[];
  error?: string;
}

export interface ProjectConfigResponse {
  generatedAt?: string;
  project?: ProjectSummary;
  rootDir?: string;
  tickEnabled?: boolean;
  config?: {
    columns?: {
      desktop?: Partial<TicketColumnsConfig>;
      mobile?: Partial<TicketColumnsConfig>;
    };
  };
  error?: string | null;
}
