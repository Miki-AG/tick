"use strict";

const config = window.__TICK_REPORT_CONFIG || {};
const POLL_MS = Number.isFinite(config.pollMs) ? config.pollMs : 5000;
const MODE = config.mode === "project" ? "project" : "landing";
const FILTER_STATUSES = ["open", "doing", "blocked", "done", "wontfix", "parked"];

const state = {
  projects: [],
  selectedProjectId: String(config.selectedProjectId || "").trim() || null,
  tickets: [],
};
const statusFilters = Object.fromEntries(FILTER_STATUSES.map((status) => [status, true]));
const PREFS_KEY = `tick-report:prefs:${MODE}:${state.selectedProjectId || "default"}`;
let minTicketId = null;
let labelFilter = "";
let previousStatusByTicket = new Map();
let statusBaselineReady = false;
let audioContext = null;
let soundUnlockBound = false;
let lastToneAtMs = 0;

const TONE_PRIORITY = {
  blocked: 6,
  doing: 5,
  done: 4,
  open: 3,
  wontfix: 2,
  parked: 1,
};

const TONE_PATTERNS = {
  open: [{ freq: 530, duration: 0.08, type: "triangle", gain: 0.028 }],
  doing: [
    { freq: 620, duration: 0.08, type: "sine", gain: 0.03 },
    { freq: 700, duration: 0.08, type: "sine", gain: 0.03 },
  ],
  blocked: [
    { freq: 230, duration: 0.12, type: "square", gain: 0.03 },
    { freq: 180, duration: 0.12, type: "square", gain: 0.03 },
  ],
  done: [
    { freq: 760, duration: 0.07, type: "triangle", gain: 0.03 },
    { freq: 980, duration: 0.1, type: "triangle", gain: 0.03 },
  ],
  wontfix: [{ freq: 300, duration: 0.12, type: "sawtooth", gain: 0.02 }],
  parked: [{ freq: 260, duration: 0.08, type: "sine", gain: 0.018 }],
};

function getAudioContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  return audioContext;
}

function primeSoundEffects() {
  if (soundUnlockBound) return;
  soundUnlockBound = true;

  const unlock = () => {
    const context = getAudioContext();
    if (!context) return;
    context.resume().catch(() => {});
  };

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
}

function withRunningAudioContext(callback) {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "running") {
    callback(context);
    return;
  }
  context
    .resume()
    .then(() => {
      if (context.state === "running") callback(context);
    })
    .catch(() => {});
}

function scheduleToneStep(context, step, startAt) {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const gain = Math.max(0.001, Math.min(0.05, step.gain || 0.028));
  const duration = Math.max(0.04, step.duration || 0.08);
  const endAt = startAt + duration;

  oscillator.type = step.type || "sine";
  oscillator.frequency.setValueAtTime(step.freq, startAt);

  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(gain, startAt + 0.015);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(endAt + 0.01);

  return endAt + 0.03;
}

function playStatusChangeTone(status) {
  const pattern = TONE_PATTERNS[status] || TONE_PATTERNS.parked;
  withRunningAudioContext((context) => {
    const nowMs = Date.now();
    if (nowMs - lastToneAtMs < 160) return;
    lastToneAtMs = nowMs;

    let cursor = context.currentTime + 0.01;
    for (const step of pattern) {
      cursor = scheduleToneStep(context, step, cursor);
    }
  });
}

function dominantStatusForTone(statuses) {
  let dominant = "parked";
  for (const status of statuses) {
    if ((TONE_PRIORITY[status] || 0) > (TONE_PRIORITY[dominant] || 0)) {
      dominant = status;
    }
  }
  return dominant;
}

function playStatusChangesForTickets(tickets) {
  const nextStatusByTicket = new Map();
  const changedStatuses = [];
  for (const ticket of tickets) {
    const ticketId = String(ticket.fileId || ticket.id || "").trim();
    if (!ticketId) continue;
    const nextStatus = normalizeStatus(ticket.status);
    nextStatusByTicket.set(ticketId, nextStatus);
    if (!statusBaselineReady) continue;
    const previousStatus = previousStatusByTicket.get(ticketId);
    if (previousStatus && previousStatus !== nextStatus) {
      changedStatuses.push(nextStatus);
    }
  }

  if (statusBaselineReady && changedStatuses.length > 0) {
    playStatusChangeTone(dominantStatusForTone(changedStatuses));
  }
  previousStatusByTicket = nextStatusByTicket;
  statusBaselineReady = true;
}

function setStatus(message) {
  const el = document.getElementById("tick-status");
  if (el) el.textContent = message;
}

function setLastRefresh() {
  const el = document.getElementById("last-refresh");
  if (el) el.textContent = `last refresh: ${new Date().toLocaleTimeString()}`;
}

function setActiveProjectPath(pathText) {
  const el = document.getElementById("active-project-path");
  if (el) el.textContent = pathText || "-";
}

function setHeaderProjectBreadcrumb(project) {
  const link = document.getElementById("header-project-link");
  if (!link) return;
  const projectId = String((project && project.id) || state.selectedProjectId || "").trim();
  if (projectId) {
    link.href = `/project/${encodeURIComponent(projectId)}`;
  }
  const label = String((project && (project.name || project.id)) || projectId || "project").trim();
  link.textContent = label || "project";
}

function normalizeStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return FILTER_STATUSES.includes(normalized) ? normalized : "parked";
}

function toTicketNumber(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLabel(value) {
  return String(value || "").trim().toLowerCase();
}

function ticketHasLabel(ticket, labelNeedle) {
  const needle = normalizeLabel(labelNeedle);
  if (!needle) return true;
  const labels = String(ticket.labels || "")
    .split(",")
    .map((part) => normalizeLabel(part))
    .filter((part) => part.length > 0);
  return labels.includes(needle);
}

function formatUpdatedParts(ticket) {
  const raw = String(ticket.updatedAt || ticket.updated || "").trim();
  if (!raw) return { date: "", time: "" };

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { date: String(ticket.updated || raw), time: "" };
  }

  return {
    date: parsed.toLocaleDateString(),
    time: parsed.toLocaleTimeString(),
  };
}

async function fetchJson(url, options) {
  const res = await fetch(url, {
    cache: "no-store",
    ...(options || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function chooseSelectedProject(projects) {
  if (!projects.length) return null;
  if (state.selectedProjectId && projects.some((project) => project.id === state.selectedProjectId)) {
    return state.selectedProjectId;
  }
  return projects[0].id;
}

function loadPreferences() {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    if (parsed.statusFilters && typeof parsed.statusFilters === "object") {
      for (const status of FILTER_STATUSES) {
        if (typeof parsed.statusFilters[status] === "boolean") {
          statusFilters[status] = parsed.statusFilters[status];
        }
      }
    }
    if (Number.isFinite(parsed.minTicketId) && parsed.minTicketId >= 0) {
      minTicketId = parsed.minTicketId;
    }
    if (typeof parsed.labelFilter === "string") {
      labelFilter = parsed.labelFilter;
    }
  } catch (err) {
    // ignore invalid local state
  }
}

function savePreferences() {
  try {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        statusFilters,
        minTicketId,
        labelFilter,
      })
    );
  } catch (err) {
    // ignore storage errors
  }
}

async function loadProjects() {
  const { res, data } = await fetchJson("/api/projects");
  if (!res.ok) {
    throw new Error(data.error || "Unable to load project list.");
  }

  state.projects = Array.isArray(data.projects) ? data.projects : [];
  state.selectedProjectId = chooseSelectedProject(state.projects);
}

function renderFilterButtons() {
  const wrap = document.getElementById("status-filters");
  if (!wrap) return;
  wrap.innerHTML = "";

  for (const status of FILTER_STATUSES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `filter-btn status-${status} ${statusFilters[status] ? "on" : "off"}`;
    btn.textContent = status;
    btn.addEventListener("click", () => {
      statusFilters[status] = !statusFilters[status];
      savePreferences();
      renderFilterButtons();
      renderRows();
    });
    wrap.appendChild(btn);
  }
}

function setupMinTicketFilter() {
  const input = document.getElementById("min-ticket-id");
  if (!input) return;
  input.value = minTicketId === null ? "" : String(minTicketId);
  input.addEventListener("input", () => {
    const raw = String(input.value || "").trim();
    if (!raw) {
      minTicketId = null;
    } else {
      const parsed = Number.parseInt(raw, 10);
      minTicketId = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
    savePreferences();
    renderRows();
  });
}

function setupLabelFilter() {
  const input = document.getElementById("label-filter-input");
  if (!input) return;
  input.value = labelFilter;
  input.addEventListener("input", () => {
    labelFilter = String(input.value || "").trim();
    savePreferences();
    renderRows();
  });
}

function renderProjectRows() {
  const body = document.getElementById("project-rows");
  const empty = document.getElementById("projects-empty");
  if (!body || !empty) return;

  body.innerHTML = "";
  if (!state.projects.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  for (const project of state.projects) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = project.name || project.id;
    tr.appendChild(nameTd);

    const pathTd = document.createElement("td");
    pathTd.className = "mono";
    pathTd.textContent = project.path || "";
    tr.appendChild(pathTd);

    const statusTd = document.createElement("td");
    if (!project.available) {
      statusTd.textContent = "unavailable";
    } else if (!project.tickEnabled) {
      statusTd.textContent = "no _ISSUES";
    } else {
      statusTd.textContent = "ok";
    }
    tr.appendChild(statusTd);

    const actionsTd = document.createElement("td");
    actionsTd.className = "project-actions";

    const go = document.createElement("a");
    go.href = `/project/${encodeURIComponent(project.id)}`;
    go.className = "project-go";
    go.textContent = "GO";
    actionsTd.appendChild(go);

    const detach = document.createElement("button");
    detach.type = "button";
    detach.className = "project-detach";
    detach.textContent = "DETACH";
    detach.addEventListener("click", () => {
      detachProject(project.id).catch((err) => {
        setStatus(`Detach failed: ${err.message}`);
      });
    });
    actionsTd.appendChild(detach);

    tr.appendChild(actionsTd);
    body.appendChild(tr);
  }
}

async function detachProject(projectId) {
  setStatus(`Detaching project ${projectId}...`);
  const { res, data } = await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/detach`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(data.error || "Unable to detach project.");
  }

  state.projects = Array.isArray(data.projects) ? data.projects : [];
  state.selectedProjectId = chooseSelectedProject(state.projects);
  renderProjectRows();
  setActiveProjectPath("-");
  setStatus(`Attached projects: ${state.projects.length}`);
  setLastRefresh();
}

function ticketUrl(ticket) {
  const fileId = String(ticket.fileId || "").trim();
  const ticketId = /^\d+$/.test(fileId) ? fileId : String(ticket.id || "").trim();
  return `/project/${encodeURIComponent(state.selectedProjectId)}/ticket/${encodeURIComponent(ticketId)}`;
}

function renderRows() {
  const tbody = document.getElementById("rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  const visibleTickets = (state.tickets || []).filter((ticket) => {
    if (!statusFilters[normalizeStatus(ticket.status)]) return false;
    if (!ticketHasLabel(ticket, labelFilter)) return false;
    if (minTicketId === null) return true;
    const idNum = toTicketNumber(ticket.id || ticket.fileId);
    return idNum !== null && idNum >= minTicketId;
  });

  if (!visibleTickets.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "empty";
    td.textContent = state.tickets.length
      ? "No tickets match current filters."
      : "No tickets found in selected project.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return 0;
  }

  for (const ticket of visibleTickets) {
    const tr = document.createElement("tr");

    const idTd = document.createElement("td");
    idTd.textContent = ticket.id || ticket.fileId || "";
    tr.appendChild(idTd);

    const titleTd = document.createElement("td");
    const link = document.createElement("a");
    link.className = "ticket-link";
    link.href = ticketUrl(ticket);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = ticket.title || "(untitled)";
    titleTd.appendChild(link);
    tr.appendChild(titleTd);

    const statusTd = document.createElement("td");
    const statusPill = document.createElement("span");
    const status = String(ticket.status || "parked").toLowerCase();
    statusPill.className = `status-pill status-${status}`;
    statusPill.textContent = status;
    statusTd.appendChild(statusPill);
    tr.appendChild(statusTd);

    const priorityTd = document.createElement("td");
    priorityTd.textContent = ticket.priority || "";
    tr.appendChild(priorityTd);

    const ownerTd = document.createElement("td");
    ownerTd.textContent = ticket.owner || "";
    tr.appendChild(ownerTd);

    const labelsTd = document.createElement("td");
    labelsTd.textContent = ticket.labels || "";
    tr.appendChild(labelsTd);

    const updatedTd = document.createElement("td");
    updatedTd.className = "updated-cell";
    const updated = formatUpdatedParts(ticket);
    const dateSpan = document.createElement("span");
    dateSpan.className = "updated-date";
    dateSpan.textContent = updated.date || "";
    updatedTd.appendChild(dateSpan);
    const timeSpan = document.createElement("span");
    timeSpan.className = "updated-time";
    timeSpan.textContent = updated.time || "";
    updatedTd.appendChild(timeSpan);
    tr.appendChild(updatedTd);

    const updatesTd = document.createElement("td");
    updatesTd.className = "updates-cell";
    updatesTd.textContent = String(ticket.updates || "").trim();
    tr.appendChild(updatesTd);

    tbody.appendChild(tr);
  }

  return visibleTickets.length;
}

async function loadProjectReport() {
  if (!state.selectedProjectId) {
    state.tickets = [];
    setActiveProjectPath("");
    renderRows();
    setStatus("Project not found.");
    setLastRefresh();
    return;
  }

  const { res, data } = await fetchJson(
    `/api/projects/${encodeURIComponent(state.selectedProjectId)}/report`
  );
  if (!res.ok) {
    throw new Error(data.error || "Unable to load report.");
  }

  state.tickets = Array.isArray(data.tickets) ? data.tickets : [];
  playStatusChangesForTickets(state.tickets);
  if (data.project && data.project.path) {
    setActiveProjectPath(data.project.path);
  }
  if (data.project) {
    setHeaderProjectBreadcrumb(data.project);
  }
  const visibleCount = renderRows();

  const popupMessage = data.popup && data.popup.message ? ` | popup: ${data.popup.message}` : "";
  const projectLabel = data.project && data.project.path ? data.project.path : state.selectedProjectId;
  setStatus(`Project: ${projectLabel} | tickets: ${visibleCount}/${state.tickets.length}${popupMessage}`);
  setLastRefresh();
}

async function refreshLanding() {
  await loadProjects();
  renderProjectRows();
  setActiveProjectPath("-");
  setStatus(`Attached projects: ${state.projects.length}`);
  setLastRefresh();
}

async function refreshProject() {
  await loadProjectReport();
}

async function init() {
  primeSoundEffects();

  if (MODE === "project") {
    loadPreferences();
    renderFilterButtons();
    setupMinTicketFilter();
    setupLabelFilter();
  }

  try {
    if (MODE === "landing") {
      await refreshLanding();
    } else {
      await refreshProject();
    }
  } catch (err) {
    setStatus(`Unable to load tick-report data: ${err.message}`);
  }

  window.setInterval(() => {
    const runner = MODE === "landing" ? refreshLanding : refreshProject;
    runner().catch((err) => {
      setStatus(`Refresh failed: ${err.message}`);
    });
  }, POLL_MS);
}

init();
