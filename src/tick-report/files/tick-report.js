"use strict";

const config = window.__TICK_REPORT_CONFIG || {};
const POLL_MS = Number.isFinite(config.pollMs) ? config.pollMs : 5000;
const MODE = config.mode === "project" ? "project" : "landing";

const state = {
  projects: [],
  selectedProjectId: String(config.selectedProjectId || "").trim() || null,
  tickets: [],
};

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

async function loadProjects() {
  const { res, data } = await fetchJson("/api/projects");
  if (!res.ok) {
    throw new Error(data.error || "Unable to load project list.");
  }

  state.projects = Array.isArray(data.projects) ? data.projects : [];
  state.selectedProjectId = chooseSelectedProject(state.projects);
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

  if (!state.tickets.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "empty";
    td.textContent = "No tickets found in selected project.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const ticket of state.tickets) {
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
    const status = String(ticket.status || "unknown").toLowerCase();
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
    updatesTd.textContent = String(ticket.updates || "");
    tr.appendChild(updatesTd);

    tbody.appendChild(tr);
  }
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
  if (data.project && data.project.path) {
    setActiveProjectPath(data.project.path);
  }
  renderRows();

  const popupMessage = data.popup && data.popup.message ? ` | popup: ${data.popup.message}` : "";
  const projectLabel = data.project && data.project.path ? data.project.path : state.selectedProjectId;
  setStatus(`Project: ${projectLabel} | tickets: ${state.tickets.length}${popupMessage}`);
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
