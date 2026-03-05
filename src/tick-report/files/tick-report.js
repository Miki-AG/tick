"use strict";

const config = window.__TICK_REPORT_CONFIG || {};
const POLL_MS = Number.isFinite(config.pollMs) ? config.pollMs : 5000;
const ROOT_DIR = String(config.rootDir || "");
const PREFS_KEY = `tick-report:prefs:${ROOT_DIR}`;
const FILTER_STATUSES = ["open", "doing", "blocked", "done", "wontfix", "unknown"];
const statusFilters = Object.fromEntries(FILTER_STATUSES.map((status) => [status, true]));

let latestTickets = [];
let minTicketId = null;
let labelFilter = "";
let dismissedPopupKey = null;
let activePopupKey = null;
let displayedPopupKey = null;
let previousStatusById = null;
let hasLoadedOnce = false;
let audioCtx = null;
let tickerResizeTimer = null;
const popupTickerState = {
  rafId: null,
  lastTs: 0,
  offset: 0,
  distance: 0,
  shiftPx: 0,
  speedPxPerSecond: 44,
};

function normalizeStatus(value) {
  const normalized = String(value || "").toLowerCase();
  return FILTER_STATUSES.includes(normalized) ? normalized : "unknown";
}

function ticketUrl(ticket) {
  const fileId = String(ticket.fileId || "").trim();
  if (/^\d+$/.test(fileId)) {
    return `/ticket/${encodeURIComponent(fileId)}`;
  }
  const fallback = String(ticket.id || "").trim();
  return `/ticket/${encodeURIComponent(fallback)}`;
}

function toTicketNumber(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
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

function parseUpdateLines(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function ticketKey(ticket) {
  return String(ticket.fileId || ticket.id || "").trim();
}

function toUpdatedMillis(ticket) {
  const raw = String(ticket.updatedAt || ticket.updated || "").trim();
  if (!raw) return -1;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return -1;
  return parsed.getTime();
}

function findLatestUpdateMarker(tickets) {
  let marker = null;

  for (const ticket of tickets || []) {
    const lines = parseUpdateLines(ticket.updates);
    if (!lines.length) continue;

    const updatedMillis = toUpdatedMillis(ticket);
    const idNum = toTicketNumber(ticket.fileId || ticket.id) ?? -1;
    const key = ticketKey(ticket);
    if (!key) continue;

    if (
      !marker ||
      updatedMillis > marker.updatedMillis ||
      (updatedMillis === marker.updatedMillis && idNum > marker.idNum)
    ) {
      marker = {
        ticketKey: key,
        lineIndex: lines.length - 1,
        updatedMillis,
        idNum,
      };
    }
  }

  return marker;
}

function normalizeLabel(value) {
  return String(value || "").trim().toLowerCase();
}

function ticketHasLabel(ticket, labelNeedle) {
  const normalizedNeedle = normalizeLabel(labelNeedle);
  if (!normalizedNeedle) return true;
  const labels = String(ticket.labels || "")
    .split(",")
    .map((item) => normalizeLabel(item))
    .filter((item) => item.length > 0);
  return labels.includes(normalizedNeedle);
}

function popupKey(popup) {
  const level = ["info", "warn", "error"].includes(popup.level) ? popup.level : "info";
  return `${level}|${String(popup.message || "").trim()}`;
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
      } else {
        minTicketId = null;
      }

      if (typeof parsed.labelFilter === "string") {
        labelFilter = parsed.labelFilter;
      } else {
        labelFilter = "";
      }
  } catch (err) {
    // Ignore invalid/unavailable localStorage.
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
    // Ignore invalid/unavailable localStorage.
  }
}

function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  audioCtx = new AudioContextCtor();
  return audioCtx;
}

function playTone(frequency, durationSeconds, gainPeak) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
  osc.start(now);
  osc.stop(now + durationSeconds + 0.02);
}

function beepStatusChange() {
  playTone(740, 0.07, 0.05);
  window.setTimeout(() => playTone(560, 0.07, 0.045), 85);
}

function beepPopup() {
  playTone(980, 0.11, 0.06);
}

function buildStatusMap(tickets) {
  const map = {};
  for (const ticket of tickets || []) {
    if (!ticket || !ticket.id) continue;
    map[String(ticket.id)] = normalizeStatus(ticket.status);
  }
  return map;
}

function hasStatusTransition(prevMap, nextMap) {
  if (!prevMap || !nextMap) return false;
  const ids = Object.keys(nextMap);
  for (const id of ids) {
    if (!Object.prototype.hasOwnProperty.call(prevMap, id)) continue;
    if (prevMap[id] !== nextMap[id]) {
      return true;
    }
  }
  return false;
}

function hidePopup() {
  const el = document.getElementById("popup-inline");
  stopPopupTickerAnimation(true);
  el.style.display = "none";
}

function stopPopupTickerAnimation(resetOffset) {
  if (popupTickerState.rafId !== null) {
    window.cancelAnimationFrame(popupTickerState.rafId);
    popupTickerState.rafId = null;
  }
  popupTickerState.lastTs = 0;
  if (resetOffset) {
    popupTickerState.offset = 0;
  }
}

function startPopupTickerAnimation(track) {
  stopPopupTickerAnimation(false);
  const step = (ts) => {
    if (popupTickerState.lastTs === 0) {
      popupTickerState.lastTs = ts;
    }
    const dt = Math.max(0, (ts - popupTickerState.lastTs) / 1000);
    popupTickerState.lastTs = ts;
    popupTickerState.offset += popupTickerState.speedPxPerSecond * dt;
    if (popupTickerState.distance > 0) {
      while (popupTickerState.offset >= popupTickerState.distance) {
        popupTickerState.offset -= popupTickerState.distance;
      }
      track.style.transform = `translateX(${popupTickerState.shiftPx - popupTickerState.offset}px)`;
    }
    popupTickerState.rafId = window.requestAnimationFrame(step);
  };
  popupTickerState.rafId = window.requestAnimationFrame(step);
}

function updatePopupTicker(options = {}) {
  const preserveOffset = options.preserveOffset !== false;
  const popup = document.getElementById("popup-inline");
  const viewport = popup.querySelector(".message-viewport");
  const track = popup.querySelector(".message-track");
  const primary = popup.querySelector(".message-primary");
  const secondary = popup.querySelector(".message-secondary");

  stopPopupTickerAnimation(false);
  popup.classList.remove("ticker");
  secondary.textContent = "";
  secondary.style.display = "none";
  track.style.transform = "translateX(0)";

  const viewportWidth = viewport.clientWidth;
  const textWidth = primary.scrollWidth;
  if (!viewportWidth || textWidth <= viewportWidth) {
    popupTickerState.distance = 0;
    if (!preserveOffset) {
      popupTickerState.offset = 0;
    }
    return;
  }

  const gap = 36;
  const distance = viewportWidth + textWidth + gap;
  popup.style.setProperty("--ticker-gap", `${gap}px`);
  popup.classList.add("ticker");
  popupTickerState.shiftPx = viewportWidth;
  if (!preserveOffset || popupTickerState.distance !== distance) {
    popupTickerState.offset = 0;
  }
  popupTickerState.distance = distance;
  startPopupTickerAnimation(track);
}

function renderFilterButtons() {
  const wrap = document.getElementById("status-filters");
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
      renderRows(latestTickets);
    });
    wrap.appendChild(btn);
  }
}

function setPopup(popup) {
  const el = document.getElementById("popup-inline");
  if (!popup || !popup.message) {
    activePopupKey = null;
    dismissedPopupKey = null;
    displayedPopupKey = null;
    hidePopup();
    return { shown: false, key: null };
  }

  const level = ["info", "warn", "error"].includes(popup.level) ? popup.level : "info";
  const key = popupKey({ level, message: popup.message });
  activePopupKey = key;
  const samePopupAsBefore = displayedPopupKey === key;

  if (dismissedPopupKey === key) {
    displayedPopupKey = null;
    hidePopup();
    return { shown: false, key };
  }

  const shown = displayedPopupKey !== key;
  displayedPopupKey = key;
  el.className = `popup-inline ${level}`;
  el.querySelector(".level").textContent = level;
  el.querySelector(".message-primary").textContent = popup.message;
  el.querySelector(".message-secondary").textContent = popup.message;
  el.querySelector(".hover-tip").textContent = popup.message;
  el.style.display = "flex";
  updatePopupTicker({ preserveOffset: samePopupAsBefore });
  return { shown, key };
}

function setupPopupDismiss() {
  const dismissBtn = document.getElementById("popup-dismiss");
  dismissBtn.addEventListener("click", () => {
    if (activePopupKey) {
      dismissedPopupKey = activePopupKey;
    }
    hidePopup();
  });
}

function setupAudioUnlock() {
  const unlock = () => {
    const ctx = ensureAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
}

function setupTickerResizeHandler() {
  window.addEventListener(
    "resize",
    () => {
      if (tickerResizeTimer) {
        window.clearTimeout(tickerResizeTimer);
      }
      tickerResizeTimer = window.setTimeout(() => {
        const popup = document.getElementById("popup-inline");
        if (popup && popup.style.display !== "none") {
          updatePopupTicker({ preserveOffset: true });
        }
      }, 120);
    },
    { passive: true }
  );
}

function renderRows(tickets) {
  const tbody = document.getElementById("rows");
  tbody.innerHTML = "";

  const visibleTickets = (tickets || []).filter((ticket) => {
    if (!statusFilters[normalizeStatus(ticket.status)]) return false;
    if (!ticketHasLabel(ticket, labelFilter)) return false;
    if (minTicketId === null) return true;
    const idNum = toTicketNumber(ticket.id);
    return idNum !== null && idNum >= minTicketId;
  });
  const latestUpdateMarker = findLatestUpdateMarker(visibleTickets);

  if (!visibleTickets.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "empty";
    td.textContent = "No tickets match current filters.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const ticket of visibleTickets) {
    const tr = document.createElement("tr");
    const url = ticketUrl(ticket);

    const idTd = document.createElement("td");
    const idLink = document.createElement("a");
    idLink.href = url;
    idLink.className = "ticket-link mono";
    idLink.textContent = ticket.id || "";
    idTd.appendChild(idLink);
    tr.appendChild(idTd);

    const titleTd = document.createElement("td");
    const titleLink = document.createElement("a");
    titleLink.href = url;
    titleLink.className = "ticket-link";
    titleLink.textContent = ticket.title || "";
    titleTd.appendChild(titleLink);
    tr.appendChild(titleTd);

    const statusTd = document.createElement("td");
    const rawStatus = String(ticket.status || "").toLowerCase();
    const pill = document.createElement("span");
    pill.className = `status-pill ${
      ["open", "doing", "blocked", "done", "wontfix"].includes(rawStatus)
        ? `status-${rawStatus}`
        : "status-unknown"
    }`;
    pill.textContent = rawStatus || "unknown";
    statusTd.appendChild(pill);
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
    const updatedParts = formatUpdatedParts(ticket);
    const updatedDate = document.createElement("div");
    updatedDate.className = "updated-date";
    updatedDate.textContent = updatedParts.date || "";
    const updatedTime = document.createElement("div");
    updatedTime.className = "updated-time";
    updatedTime.textContent = updatedParts.time || "";
    updatedTd.appendChild(updatedDate);
    updatedTd.appendChild(updatedTime);
    tr.appendChild(updatedTd);

    const updatesTd = document.createElement("td");
    updatesTd.className = "updates-cell";
    const lines = parseUpdateLines(ticket.updates);
    const key = ticketKey(ticket);
    for (let i = 0; i < lines.length; i += 1) {
      const lineEl = document.createElement("div");
      lineEl.className = "update-line";
      lineEl.textContent = lines[i];
      if (
        latestUpdateMarker &&
        latestUpdateMarker.ticketKey === key &&
        latestUpdateMarker.lineIndex === i
      ) {
        lineEl.classList.add("latest-update-line");
      }
      updatesTd.appendChild(lineEl);
    }
    tr.appendChild(updatesTd);

    tbody.appendChild(tr);
  }
}

function setupMinTicketFilter() {
  const input = document.getElementById("min-ticket-id");
  input.value = minTicketId === null ? "" : String(minTicketId);
  input.addEventListener("input", () => {
    const raw = String(input.value || "").trim();
    if (raw === "") {
      minTicketId = null;
    } else {
      const parsed = Number.parseInt(raw, 10);
      minTicketId = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
    savePreferences();
    renderRows(latestTickets);
  });
}

function setupLabelFilter() {
  const input = document.getElementById("label-filter-input");
  input.value = labelFilter;
  input.addEventListener("input", () => {
    labelFilter = String(input.value || "").trim();
    savePreferences();
    renderRows(latestTickets);
  });
}

async function loadReport() {
  try {
    const res = await fetch("/api/report", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const statusEl = document.getElementById("tick-status");
    const rootEl = document.getElementById("root-dir");
    if (rootEl && data.rootDir) {
      rootEl.textContent = data.rootDir;
    }
    if (!data.tickEnabled) {
      statusEl.textContent = "tick is not initialized in this folder (missing ./_ISSUES).";
    } else {
      statusEl.textContent = "Watching ./_ISSUES and ./_ISSUES/status.json";
    }

    const nextStatusById = buildStatusMap(data.tickets || []);
    const statusChanged = hasStatusTransition(previousStatusById, nextStatusById);
    previousStatusById = nextStatusById;

    latestTickets = data.tickets || [];
    renderRows(latestTickets);
    const popupState = setPopup(data.popup || null);

    if (hasLoadedOnce && statusChanged) {
      beepStatusChange();
    }
    if (hasLoadedOnce && popupState && popupState.shown && popupState.key) {
      beepPopup();
    }

    document.getElementById("last-refresh").textContent = `last refresh: ${new Date().toLocaleTimeString()}`;
    hasLoadedOnce = true;
  } catch (err) {
    setPopup({ level: "error", message: `Unable to fetch report: ${err.message}` });
  }
}

loadPreferences();
renderFilterButtons();
setupMinTicketFilter();
setupLabelFilter();
setupPopupDismiss();
setupAudioUnlock();
setupTickerResizeHandler();
loadReport();
window.setInterval(loadReport, POLL_MS);
