import { useCallback, useEffect, useMemo, useState } from "react";

import { getTicket, saveTicket } from "@/lib/api";
import type { BootstrapConfig } from "@/lib/bootstrap";
import { formatLabelsForInput, normalizeTicketIdForApi, parseLabelsText } from "@/lib/format";
import type { ProjectSummary, TicketSummary } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface TicketPageProps {
  config: BootstrapConfig;
}

type SaveTone = "neutral" | "dirty" | "ok" | "error";

interface TicketFormState {
  title: string;
  status: string;
  priority: string;
  owner: string;
  labels: string;
  updates: string;
  body: string;
}

const STATUS_OPTIONS = new Set(["open", "doing", "blocked", "done", "wontfix"]);
const PRIORITY_OPTIONS = new Set(["p0", "p1", "p2", "p3"]);

function emptyFormState(): TicketFormState {
  return {
    title: "",
    status: "open",
    priority: "p2",
    owner: "",
    labels: "",
    updates: "",
    body: "",
  };
}

function draftSnapshotFromForm(form: TicketFormState): string {
  return JSON.stringify({
    title: String(form.title || "").trim(),
    status: String(form.status || "").trim().toLowerCase(),
    priority: String(form.priority || "").trim().toLowerCase(),
    owner: String(form.owner || "").trim(),
    labels: parseLabelsText(form.labels || ""),
    updates: String(form.updates || "").trim(),
    body: String(form.body || "").replace(/\r\n/g, "\n"),
  });
}

function ticketToForm(ticket: TicketSummary): TicketFormState {
  const status = String(ticket.status || "").trim().toLowerCase();
  const priority = String(ticket.priority || "").trim().toLowerCase();

  return {
    title: ticket.title || "",
    status: STATUS_OPTIONS.has(status) ? status : "open",
    priority: PRIORITY_OPTIONS.has(priority) ? priority : "p2",
    owner: ticket.owner || "",
    labels: formatLabelsForInput(ticket.labels || ""),
    updates: ticket.updates || "",
    body: String(ticket.body || ""),
  };
}

export function TicketPage({ config }: TicketPageProps) {
  const rawTicketId = config.ticketId || "";
  const projectId = config.projectId || "";
  const ticketIdForApi = normalizeTicketIdForApi(rawTicketId);

  const [project, setProject] = useState<ProjectSummary | null>(
    projectId
      ? {
          id: projectId,
          name: projectId,
          path: config.projectPath || "",
          available: true,
          tickEnabled: true,
        }
      : null
  );
  const [ticket, setTicket] = useState<TicketSummary | null>(null);
  const [rootDir, setRootDir] = useState(config.projectPath || "-");
  const [statusMessage, setStatusMessage] = useState("loading...");
  const [lastRefreshText, setLastRefreshText] = useState("last refresh: -");
  const [form, setForm] = useState<TicketFormState>(emptyFormState);
  const [baseline, setBaseline] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState("No changes");
  const [saveTone, setSaveTone] = useState<SaveTone>("neutral");

  const dirty = useMemo(() => {
    if (!loaded) return false;
    return draftSnapshotFromForm(form) !== baseline;
  }, [baseline, form, loaded]);

  const applyTicketToForm = useCallback((nextTicket: TicketSummary) => {
    const nextForm = ticketToForm(nextTicket);
    const nextBaseline = draftSnapshotFromForm(nextForm);

    setTicket(nextTicket);
    setForm(nextForm);
    setBaseline(nextBaseline);
    setLoaded(true);
    setSaveTone("neutral");
    setSaveNote("No changes");
  }, []);

  const loadTicket = useCallback(async () => {
    if (!projectId) {
      setStatusMessage("Missing project id.");
      setSaveNote("Missing project id");
      setSaveTone("error");
      return;
    }

    if (!rawTicketId) {
      setStatusMessage("Missing ticket id.");
      setSaveNote("Missing ticket id");
      setSaveTone("error");
      return;
    }

    const data = await getTicket(projectId, ticketIdForApi);
    setProject(data.project || project);
    setRootDir(data.rootDir || config.projectPath || "-");

    if (dirty && !saving) {
      setStatusMessage("Unsaved changes. Auto-refresh paused.");
      return;
    }

    if (data.ticket) {
      applyTicketToForm(data.ticket);
    }

    setStatusMessage("Watching ticket data from selected project.");
    setLastRefreshText(`last refresh: ${new Date().toLocaleTimeString()}`);
  }, [
    applyTicketToForm,
    config.projectPath,
    dirty,
    project,
    projectId,
    rawTicketId,
    saving,
    ticketIdForApi,
  ]);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        await loadTicket();
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "Unable to fetch ticket.";
        setStatusMessage(`Unable to fetch ticket: ${message}`);
        setSaveNote("Load failed");
        setSaveTone("error");
      }
    }

    run();
    const interval = window.setInterval(run, config.pollMs);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [config.pollMs, loadTicket]);

  useEffect(() => {
    if (saving) return;
    if (dirty) {
      setSaveNote("Unsaved changes");
      setSaveTone("dirty");
      return;
    }
    setSaveNote("No changes");
    setSaveTone("neutral");
  }, [dirty, saving]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void onSave();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  const onSave = useCallback(async () => {
    if (saving) return;
    if (!dirty) {
      setSaveNote("No changes");
      setSaveTone("neutral");
      return;
    }

    const title = String(form.title || "").trim();
    if (!title) {
      setSaveNote("Title is required");
      setSaveTone("error");
      return;
    }

    if (!projectId || !rawTicketId) {
      setSaveNote("Missing project or ticket id");
      setSaveTone("error");
      return;
    }

    setSaving(true);
    setSaveTone("neutral");
    setSaveNote("Saving...");
    setStatusMessage("Saving ticket...");

    try {
      const data = await saveTicket(projectId, ticketIdForApi, {
        title,
        status: String(form.status || "").trim().toLowerCase(),
        priority: String(form.priority || "").trim().toLowerCase(),
        owner: String(form.owner || "").trim(),
        labels: parseLabelsText(form.labels || ""),
        updates: String(form.updates || "").trim(),
        body: String(form.body || "").replace(/\r\n/g, "\n"),
      });

      if (data.ticket) {
        applyTicketToForm(data.ticket);
      }
      setProject(data.project || project);
      setSaveNote("Saved");
      setSaveTone("ok");
      setStatusMessage("Saved. Watching ticket data from selected project.");
      setLastRefreshText(`last refresh: ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setSaveNote(message);
      setSaveTone("error");
      setStatusMessage("Save failed.");
    } finally {
      setSaving(false);
    }
  }, [
    applyTicketToForm,
    dirty,
    form,
    project,
    projectId,
    rawTicketId,
    saving,
    ticketIdForApi,
  ]);

  const saveToneClass =
    saveTone === "error"
      ? "text-rose-300"
      : saveTone === "ok"
        ? "text-emerald-300"
        : saveTone === "dirty"
          ? "text-amber-200"
          : "text-muted-foreground";

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto w-full max-w-[1440px]">
        <PageHeader
          intervalMs={config.pollMs}
          project={project}
          ticketId={rawTicketId}
          rootDir={rootDir}
          lastRefreshText={lastRefreshText}
        />

        <Card className="mb-4">
          <CardContent className="pt-6">
            <Alert id="ticket-status">{statusMessage}</Alert>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 font-mono text-xs" id="ticket-id">
                {ticket?.id || ticket?.fileId || "-"}
              </div>
              <Input
                id="ticket-title-input"
                placeholder="Ticket title"
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.currentTarget.value }))}
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Body</div>
                <Textarea
                  id="ticket-body-input"
                  className="min-h-[460px] resize-y font-mono"
                  placeholder="Ticket body"
                  spellCheck={false}
                  value={form.body}
                  onChange={(event) => setForm((current) => ({ ...current, body: event.currentTarget.value }))}
                />
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</div>
                  <Select
                    id="ticket-status-input"
                    value={form.status}
                    onChange={(event) => setForm((current) => ({ ...current, status: event.currentTarget.value }))}
                  >
                    <option value="open">open</option>
                    <option value="doing">doing</option>
                    <option value="blocked">blocked</option>
                    <option value="done">done</option>
                    <option value="wontfix">wontfix</option>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Priority</div>
                  <Select
                    id="ticket-priority-input"
                    value={form.priority}
                    onChange={(event) => setForm((current) => ({ ...current, priority: event.currentTarget.value }))}
                  >
                    <option value="p0">p0</option>
                    <option value="p1">p1</option>
                    <option value="p2">p2</option>
                    <option value="p3">p3</option>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Owner</div>
                  <Input
                    id="ticket-owner-input"
                    value={form.owner}
                    onChange={(event) => setForm((current) => ({ ...current, owner: event.currentTarget.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Updated</div>
                  <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm" id="ticket-updated">
                    {ticket?.updated || "-"}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labels</div>
                  <Input
                    id="ticket-labels-input"
                    placeholder="comma,separated,labels"
                    value={form.labels}
                    onChange={(event) => setForm((current) => ({ ...current, labels: event.currentTarget.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Updates</div>
                  <Textarea
                    id="ticket-updates-input"
                    className="min-h-28"
                    placeholder="LLM/user status updates"
                    value={form.updates}
                    onChange={(event) => setForm((current) => ({ ...current, updates: event.currentTarget.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">File</div>
                  <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 font-mono text-xs" id="ticket-file">
                    {_ISSUESFilePath(ticket)}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    disabled={saving || !dirty}
                    id="ticket-save-btn"
                    onClick={() => {
                      void onSave();
                    }}
                    type="button"
                  >
                    Save
                  </Button>
                  <div className={`text-sm ${saveToneClass}`} id="ticket-save-note">
                    {saveNote}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function _ISSUESFilePath(ticket: TicketSummary | null): string {
  const name = String(ticket?.fileName || "").trim();
  return name ? `_ISSUES/${name}` : "-";
}
