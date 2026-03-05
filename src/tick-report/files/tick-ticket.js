"use strict";

const config = window.__TICK_TICKET_CONFIG || {};
const POLL_MS = Number.isFinite(config.pollMs) ? config.pollMs : 5000;
const ROOT_DIR = String(config.rootDir || "");
const RAW_TICKET_ID = String(config.ticketId || "").trim();

const state = {
  loaded: false,
  dirty: false,
  saving: false,
  baseline: "",
};

const refs = {
  rootDir: document.getElementById("root-dir"),
  ticketStatus: document.getElementById("ticket-status"),
  lastRefresh: document.getElementById("last-refresh"),
  pageTitle: document.getElementById("ticket-page-title"),
  ticketId: document.getElementById("ticket-id"),
  ticketUpdated: document.getElementById("ticket-updated"),
  ticketFile: document.getElementById("ticket-file"),
  titleInput: document.getElementById("ticket-title-input"),
  statusInput: document.getElementById("ticket-status-input"),
  priorityInput: document.getElementById("ticket-priority-input"),
  ownerInput: document.getElementById("ticket-owner-input"),
  labelsInput: document.getElementById("ticket-labels-input"),
  updatesInput: document.getElementById("ticket-updates-input"),
  bodyInput: document.getElementById("ticket-body-input"),
  saveBtn: document.getElementById("ticket-save-btn"),
  saveNote: document.getElementById("ticket-save-note"),
};

const STATUS_OPTIONS = new Set(["open", "doing", "blocked", "done", "wontfix"]);
const PRIORITY_OPTIONS = new Set(["p0", "p1", "p2", "p3"]);

function normalizeTicketIdForApi(value) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) return text;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return text;
  return String(parsed).padStart(4, "0");
}

function parseLabelsText(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function formatLabelsForInput(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(", ");
}

function setStatusLine(message) {
  refs.ticketStatus.textContent = message;
}

function setSaveNote(message, tone) {
  refs.saveNote.textContent = message;
  refs.saveNote.className = "ticket-save-note";
  if (tone) refs.saveNote.classList.add(tone);
}

function setSaveButtonState() {
  refs.saveBtn.disabled = state.saving || !state.dirty;
}

function draftSnapshotFromForm() {
  const payload = {
    title: String(refs.titleInput.value || "").trim(),
    status: String(refs.statusInput.value || "").trim().toLowerCase(),
    priority: String(refs.priorityInput.value || "").trim().toLowerCase(),
    owner: String(refs.ownerInput.value || "").trim(),
    labels: parseLabelsText(refs.labelsInput.value || ""),
    updates: String(refs.updatesInput.value || "").trim(),
    body: String(refs.bodyInput.value || "").replace(/\r\n/g, "\n"),
  };
  return JSON.stringify(payload);
}

function setDirty(flag) {
  state.dirty = flag;
  setSaveButtonState();
  if (state.saving) return;
  if (flag) {
    setSaveNote("Unsaved changes", "dirty");
  } else {
    setSaveNote("No changes", "");
  }
}

function updateDirtyFromForm() {
  if (!state.loaded || state.saving) return;
  const current = draftSnapshotFromForm();
  setDirty(current !== state.baseline);
}

function applyTicketToForm(ticket, preserveDirty = false) {
  const status = String(ticket.status || "").trim().toLowerCase();
  const priority = String(ticket.priority || "").trim().toLowerCase();

  refs.ticketId.textContent = ticket.id || ticket.fileId || "-";
  refs.ticketUpdated.textContent = ticket.updated || "-";
  refs.ticketFile.textContent = `_ISSUES/${ticket.fileName || ""}`;
  refs.pageTitle.textContent = `ticket ${ticket.id || ticket.fileId || RAW_TICKET_ID}`;

  refs.titleInput.value = ticket.title || "";
  refs.statusInput.value = STATUS_OPTIONS.has(status) ? status : "open";
  refs.priorityInput.value = PRIORITY_OPTIONS.has(priority) ? priority : "p2";
  refs.ownerInput.value = ticket.owner || "";
  refs.labelsInput.value = formatLabelsForInput(ticket.labels || "");
  refs.updatesInput.value = ticket.updates || "";
  refs.bodyInput.value = String(ticket.body || "");

  state.baseline = draftSnapshotFromForm();
  if (!preserveDirty) {
    setDirty(false);
  }
}

async function fetchTicket() {
  const idForApi = normalizeTicketIdForApi(RAW_TICKET_ID);
  const res = await fetch(`/api/ticket/${encodeURIComponent(idForApi)}`, {
    cache: "no-store",
  });
  const data = await res.json();
  return { res, data, idForApi };
}

async function loadTicket() {
  try {
    const { res, data, idForApi } = await fetchTicket();
    if (refs.rootDir && data.rootDir) refs.rootDir.textContent = data.rootDir;

    if (!res.ok) {
      if (!data.tickEnabled) {
        setStatusLine("tick is not initialized in this folder (missing ./_ISSUES).");
      } else {
        setStatusLine(data.error || `Unable to load ticket ${idForApi}.`);
      }
      setSaveNote("Load failed", "error");
      return;
    }

    if (state.dirty && !state.saving) {
      setStatusLine("Unsaved changes. Auto-refresh paused.");
      return;
    }

    applyTicketToForm(data.ticket || {});
    state.loaded = true;
    setStatusLine("Watching ticket data from ./_ISSUES");
    refs.lastRefresh.textContent = `last refresh: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    setStatusLine(`Unable to fetch ticket: ${err.message}`);
    setSaveNote("Load failed", "error");
  }
}

async function saveTicket() {
  if (state.saving) return;
  if (!state.dirty) {
    setSaveNote("No changes", "");
    return;
  }

  const title = String(refs.titleInput.value || "").trim();
  if (!title) {
    setSaveNote("Title is required", "error");
    return;
  }

  const idForApi = normalizeTicketIdForApi(RAW_TICKET_ID);
  const payload = {
    title,
    status: String(refs.statusInput.value || "").trim().toLowerCase(),
    priority: String(refs.priorityInput.value || "").trim().toLowerCase(),
    owner: String(refs.ownerInput.value || "").trim(),
    labels: parseLabelsText(refs.labelsInput.value || ""),
    updates: String(refs.updatesInput.value || "").trim(),
    body: String(refs.bodyInput.value || "").replace(/\r\n/g, "\n"),
  };

  state.saving = true;
  setSaveButtonState();
  setSaveNote("Saving...", "");
  setStatusLine("Saving ticket...");

  try {
    const res = await fetch(`/api/ticket/${encodeURIComponent(idForApi)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      setSaveNote(data.error || "Save failed", "error");
      setStatusLine("Save failed.");
      return;
    }

    applyTicketToForm(data.ticket || {});
    state.loaded = true;
    setSaveNote("Saved", "ok");
    setStatusLine("Saved. Watching ticket data from ./_ISSUES");
    refs.lastRefresh.textContent = `last refresh: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    setSaveNote(`Save failed: ${err.message}`, "error");
    setStatusLine("Save failed.");
  } finally {
    state.saving = false;
    setSaveButtonState();
  }
}

function attachEditorEvents() {
  const inputs = [
    refs.titleInput,
    refs.statusInput,
    refs.priorityInput,
    refs.ownerInput,
    refs.labelsInput,
    refs.updatesInput,
    refs.bodyInput,
  ];
  for (const el of inputs) {
    el.addEventListener("input", updateDirtyFromForm);
    el.addEventListener("change", updateDirtyFromForm);
  }

  refs.saveBtn.addEventListener("click", () => {
    saveTicket();
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveTicket();
    }
  });
}

if (!ROOT_DIR) {
  setStatusLine("Missing root directory context.");
  setSaveNote("Missing root context", "error");
} else if (!RAW_TICKET_ID) {
  setStatusLine("Missing ticket id.");
  setSaveNote("Missing ticket id", "error");
} else {
  attachEditorEvents();
  loadTicket();
  window.setInterval(loadTicket, POLL_MS);
}
