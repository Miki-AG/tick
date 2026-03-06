import type {
  DetachProjectResponse,
  ProjectConfigResponse,
  ProjectReportResponse,
  ProjectsResponse,
  TicketColumnsConfig,
  TicketResponse,
} from "@/lib/types";

interface FetchJsonResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<FetchJsonResult<T>> {
  const response = await fetch(url, {
    cache: "no-store",
    ...(init || {}),
  });

  const data = (await response.json().catch(() => ({}))) as T;
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export async function getProjects(): Promise<ProjectsResponse> {
  const { ok, data } = await fetchJson<ProjectsResponse>("/api/projects");
  if (!ok) {
    throw new Error(data.error || "Unable to load project list.");
  }
  return data;
}

export async function getProjectReport(projectId: string): Promise<ProjectReportResponse> {
  const { ok, data } = await fetchJson<ProjectReportResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/report`
  );
  if (!ok) {
    throw new Error(data.error || "Unable to load report.");
  }
  return data;
}

export async function getProjectConfig(projectId: string): Promise<ProjectConfigResponse> {
  const { ok, data } = await fetchJson<ProjectConfigResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/config`
  );
  if (!ok) {
    throw new Error(data.error || "Unable to load project config.");
  }
  return data;
}

export async function saveProjectConfig(
  projectId: string,
  payload: {
    columns: {
      desktop?: Partial<TicketColumnsConfig>;
      mobile?: Partial<TicketColumnsConfig>;
    };
  }
): Promise<ProjectConfigResponse> {
  const { ok, data } = await fetchJson<ProjectConfigResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/config`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!ok) {
    throw new Error(data.error || "Unable to save project config.");
  }
  return data;
}

export async function getTicket(projectId: string, ticketId: string): Promise<TicketResponse> {
  const { ok, data } = await fetchJson<TicketResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/ticket/${encodeURIComponent(ticketId)}`
  );

  if (!ok) {
    throw new Error(data.error || `Unable to load ticket ${ticketId}.`);
  }

  return data;
}

export async function saveTicket(
  projectId: string,
  ticketId: string,
  payload: {
    title: string;
    status: string;
    priority: string;
    owner: string;
    labels: string[];
    updates: string;
    body: string;
  }
): Promise<TicketResponse> {
  const { ok, data } = await fetchJson<TicketResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/ticket/${encodeURIComponent(ticketId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!ok) {
    throw new Error(data.error || "Save failed.");
  }

  return data;
}

export async function detachProject(projectId: string): Promise<DetachProjectResponse> {
  const { ok, data } = await fetchJson<DetachProjectResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/detach`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!ok) {
    throw new Error(data.error || "Unable to detach project.");
  }

  return data;
}
