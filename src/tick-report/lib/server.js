"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { ISSUES_DIR_NAME } = require("./constants");
const { updateTicketById } = require("./ticket-editor");
const { readProjectConfig, readTicketById, readTickets, updateProjectConfig } = require("./tickets");
const { renderTemplate } = require("./template");
const {
  attachProject,
  clearDaemonMetaIfSelf,
  detachProjectById,
  getProjectById,
  listProjects,
} = require("./global-state");

const FILES_DIR = path.join(__dirname, "..", "files");
const LANDING_TEMPLATE_PATH = path.join(FILES_DIR, "landing.ejs");
const PROJECT_TEMPLATE_PATH = path.join(FILES_DIR, "project.ejs");
const TICKET_TEMPLATE_PATH = path.join(FILES_DIR, "ticket.ejs");
const CSS_PATH = path.join(FILES_DIR, "tick-report.css");
const JS_PATH = path.join(FILES_DIR, "tick-report.js");
const TICKET_JS_PATH = path.join(FILES_DIR, "tick-ticket.js");
const WEB_DIST_DIR = path.join(__dirname, "..", "web", "dist");
const WEB_INDEX_PATH = path.join(WEB_DIST_DIR, "index.html");
const UI_MODE = String(process.env.TICK_REPORT_UI_MODE || "shadcn").trim().toLowerCase();
const BOOTSTRAP_TAG_START = '<script id="tick-report-bootstrap-data" type="application/json">';
const BOOTSTRAP_TAG_END = "</script>";
const MAX_JSON_BODY_BYTES = 1024 * 1024;
let webIndexCache = null;

function decodeSegment(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (err) {
    return null;
  }
}

function shouldUseShadcnUi() {
  if (UI_MODE === "legacy") return false;
  try {
    const stat = fs.statSync(WEB_INDEX_PATH);
    return stat.isFile();
  } catch (err) {
    return false;
  }
}

function escapeJsonForInlineScript(value) {
  return String(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function loadWebIndexTemplate() {
  const stat = fs.statSync(WEB_INDEX_PATH);
  if (webIndexCache && webIndexCache.mtimeMs === stat.mtimeMs) {
    return webIndexCache.html;
  }
  const html = fs.readFileSync(WEB_INDEX_PATH, "utf8");
  webIndexCache = {
    mtimeMs: stat.mtimeMs,
    html,
  };
  return html;
}

function buildShadcnHtml(bootstrapConfig) {
  const html = loadWebIndexTemplate();
  const start = html.indexOf(BOOTSTRAP_TAG_START);
  if (start === -1) {
    return html;
  }

  const contentStart = start + BOOTSTRAP_TAG_START.length;
  const end = html.indexOf(BOOTSTRAP_TAG_END, contentStart);
  if (end === -1) {
    return html;
  }

  const serialized = escapeJsonForInlineScript(JSON.stringify(bootstrapConfig || {}));
  return `${html.slice(0, contentStart)}${serialized}${html.slice(end)}`;
}

function buildLandingHtml(intervalMs, useShadcnUi) {
  if (useShadcnUi) {
    return buildShadcnHtml({
      mode: "landing",
      pollMs: intervalMs,
      selectedProjectId: null,
      projectId: null,
      projectPath: null,
      ticketId: null,
    });
  }

  return renderTemplate(LANDING_TEMPLATE_PATH, {
    intervalMs,
    mode: "landing",
    selectedProject: null,
    configJson: JSON.stringify({ pollMs: intervalMs, mode: "landing", selectedProjectId: null }),
  });
}

function buildProjectHtml(intervalMs, selectedProject, useShadcnUi) {
  if (useShadcnUi) {
    return buildShadcnHtml({
      mode: "project",
      pollMs: intervalMs,
      selectedProjectId: selectedProject.id,
      projectId: selectedProject.id,
      projectPath: selectedProject.path,
      ticketId: null,
    });
  }

  return renderTemplate(PROJECT_TEMPLATE_PATH, {
    intervalMs,
    mode: "project",
    selectedProject,
    configJson: JSON.stringify({
      pollMs: intervalMs,
      mode: "project",
      selectedProjectId: selectedProject.id,
    }),
  });
}

function buildTicketHtml(intervalMs, project, ticketId, useShadcnUi) {
  if (useShadcnUi) {
    return buildShadcnHtml({
      mode: "ticket",
      pollMs: intervalMs,
      selectedProjectId: project.id,
      projectId: project.id,
      projectPath: project.path,
      ticketId,
    });
  }

  return renderTemplate(TICKET_TEMPLATE_PATH, {
    intervalMs,
    project,
    ticketId,
    configJson: JSON.stringify({
      pollMs: intervalMs,
      ticketId,
      projectId: project.id,
      projectPath: project.path,
    }),
  });
}

function serveStaticFile(res, filePath, contentType, cacheControl = "no-store, no-cache, must-revalidate") {
  try {
    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Unable to load asset: ${path.basename(filePath)}\n`);
  }
}

function contentTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function resolveWebDistPath(pathname) {
  const relativePath = String(pathname || "").replace(/^\/+/, "");
  const normalizedPath = path.normalize(relativePath);
  if (!normalizedPath || normalizedPath.startsWith("..")) {
    return null;
  }

  const resolved = path.join(WEB_DIST_DIR, normalizedPath);
  if (resolved !== WEB_DIST_DIR && !resolved.startsWith(`${WEB_DIST_DIR}${path.sep}`)) {
    return null;
  }

  return resolved;
}

function tryServeWebDistAsset(pathname, res) {
  const resolved = resolveWebDistPath(pathname);
  if (!resolved) return false;

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    return false;
  }

  if (!stat.isFile()) return false;
  const immutable = pathname.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
  serveStaticFile(res, resolved, contentTypeForPath(resolved), immutable);
  return true;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let byteLength = 0;
    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      byteLength += Buffer.byteLength(chunk, "utf8");
      if (byteLength > MAX_JSON_BODY_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

function projectSummary(project) {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    available: !!project.available,
    tickEnabled: !!project.tickEnabled,
    attachedAt: project.attachedAt || "",
    lastAttachedAt: project.lastAttachedAt || "",
  };
}

function chooseProjectIdFromUrl(url, projects) {
  const requested = String(url.searchParams.get("project") || "").trim();
  if (requested && projects.some((project) => project.id === requested)) {
    return requested;
  }
  return projects.length > 0 ? projects[0].id : null;
}

function getProjectOrError(projectId, projects) {
  if (!projectId) {
    return { project: null, error: "No project selected.", code: 400 };
  }
  const project = projects.find((item) => item.id === projectId) || null;
  if (!project) {
    return { project: null, error: `Project not found: ${projectId}`, code: 404 };
  }
  return { project, error: null, code: 200 };
}

function splitPath(pathname) {
  return String(pathname || "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeSegment(segment));
}

function createServer(port, intervalMs, host = "127.0.0.1") {
  let server;
  const useShadcnUi = shouldUseShadcnUi();

  if (UI_MODE !== "legacy" && !useShadcnUi) {
    process.stderr.write(
      `tick-report warning: shadcn build not found at ${WEB_INDEX_PATH}; falling back to legacy UI.\n`
    );
  }

  function shutdown(code = 0) {
    if (!server) {
      clearDaemonMetaIfSelf();
      process.exit(code);
      return;
    }

    const forceTimer = setTimeout(() => {
      try {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
      } catch (err) {
        // no-op
      }
      clearDaemonMetaIfSelf();
      process.exit(code);
    }, 1500);
    if (typeof forceTimer.unref === "function") forceTimer.unref();

    if (typeof server.closeIdleConnections === "function") {
      try {
        server.closeIdleConnections();
      } catch (err) {
        // no-op
      }
    }

    server.close(() => {
      clearTimeout(forceTimer);
      clearDaemonMetaIfSelf();
      process.exit(code);
    });
  }

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    const parts = splitPath(pathname);
    const method = String(req.method || "GET").toUpperCase();
    const projects = listProjects();

    if (pathname === "/api/projects" && method === "GET") {
      sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        projects: projects.map(projectSummary),
        selectedProjectId: chooseProjectIdFromUrl(url, projects),
      });
      return;
    }

    if (pathname === "/api/projects/attach" && method === "POST") {
      try {
        const contentType = String(req.headers["content-type"] || "").toLowerCase();
        if (!contentType.includes("application/json")) {
          sendJson(res, 415, {
            generatedAt: new Date().toISOString(),
            error: "Content-Type must be application/json.",
          });
          return;
        }
        const body = await readJsonBody(req);
        const repoPath = String(body.path || "").trim();
        if (!repoPath) {
          sendJson(res, 400, {
            generatedAt: new Date().toISOString(),
            error: "Missing required field: path",
          });
          return;
        }
        const attached = attachProject(repoPath);
        sendJson(res, 200, {
          generatedAt: new Date().toISOString(),
          attached: projectSummary(attached.project),
          added: attached.added,
        });
      } catch (err) {
        sendJson(res, 400, {
          generatedAt: new Date().toISOString(),
          error: err.message,
        });
      }
      return;
    }

    if (parts.length === 4 && parts[0] === "api" && parts[1] === "projects" && parts[3] === "detach") {
      if (!(method === "POST" || method === "DELETE")) {
        sendJson(res, 405, {
          generatedAt: new Date().toISOString(),
          error: "Method not allowed.",
        });
        return;
      }
      const projectId = parts[2];
      const detached = detachProjectById(projectId);
      if (!detached.removed) {
        sendJson(res, 404, {
          generatedAt: new Date().toISOString(),
          error: `Project not found: ${projectId}`,
        });
        return;
      }
      sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        detached: projectSummary(detached.project),
        projects: listProjects().map(projectSummary),
      });
      return;
    }

    if (parts.length === 4 && parts[0] === "api" && parts[1] === "projects" && parts[3] === "report") {
      const projectId = parts[2];
      const { project, error, code } = getProjectOrError(projectId, projects);
      if (!project) {
        sendJson(res, code, {
          generatedAt: new Date().toISOString(),
          error,
        });
        return;
      }
      const payload = readTickets(project.path);
      sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        project: projectSummary(project),
        rootDir: project.path,
        tickEnabled: payload.tickEnabled,
        tickets: payload.tickets,
        popup: payload.popup,
      });
      return;
    }

    if (parts.length === 4 && parts[0] === "api" && parts[1] === "projects" && parts[3] === "config") {
      const projectId = parts[2];
      const { project, error, code } = getProjectOrError(projectId, projects);
      if (!project) {
        sendJson(res, code, {
          generatedAt: new Date().toISOString(),
          error,
        });
        return;
      }

      if (method === "GET") {
        const payload = readProjectConfig(project.path);
        sendJson(res, 200, {
          generatedAt: new Date().toISOString(),
          project: projectSummary(project),
          rootDir: project.path,
          tickEnabled: payload.tickEnabled,
          config: payload.config,
          error: payload.error || null,
        });
        return;
      }

      if (method === "POST" || method === "PUT" || method === "PATCH") {
        try {
          const contentType = String(req.headers["content-type"] || "").toLowerCase();
          if (!contentType.includes("application/json")) {
            sendJson(res, 415, {
              generatedAt: new Date().toISOString(),
              project: projectSummary(project),
              error: "Content-Type must be application/json.",
            });
            return;
          }
          const body = await readJsonBody(req);
          const result = updateProjectConfig(project.path, body);
          sendJson(res, result.code, {
            generatedAt: new Date().toISOString(),
            project: projectSummary(project),
            rootDir: project.path,
            tickEnabled: result.tickEnabled,
            config: result.config,
            error: result.error || null,
          });
        } catch (err) {
          sendJson(res, 400, {
            generatedAt: new Date().toISOString(),
            project: projectSummary(project),
            error: err.message,
          });
        }
        return;
      }

      sendJson(res, 405, {
        generatedAt: new Date().toISOString(),
        project: projectSummary(project),
        error: "Method not allowed.",
      });
      return;
    }

    if (parts.length === 5 && parts[0] === "api" && parts[1] === "projects" && parts[3] === "ticket") {
      const projectId = parts[2];
      const ticketId = parts[4];
      const { project, error, code } = getProjectOrError(projectId, projects);
      if (!project) {
        sendJson(res, code, {
          generatedAt: new Date().toISOString(),
          error,
        });
        return;
      }

      if (method === "POST" || method === "PUT" || method === "PATCH") {
        try {
          const contentType = String(req.headers["content-type"] || "").toLowerCase();
          if (!contentType.includes("application/json")) {
            sendJson(res, 415, {
              generatedAt: new Date().toISOString(),
              project: projectSummary(project),
              error: "Content-Type must be application/json.",
            });
            return;
          }
          const body = await readJsonBody(req);
          const result = updateTicketById(project.path, ticketId, body);
          if (!result.ok) {
            sendJson(res, result.code, {
              generatedAt: new Date().toISOString(),
              project: projectSummary(project),
              error: result.error,
            });
            return;
          }
          sendJson(res, 200, {
            generatedAt: new Date().toISOString(),
            project: projectSummary(project),
            rootDir: project.path,
            tickEnabled: true,
            ticket: result.ticket,
            popup: result.popup,
          });
        } catch (err) {
          sendJson(res, 400, {
            generatedAt: new Date().toISOString(),
            project: projectSummary(project),
            error: err.message,
          });
        }
        return;
      }

      const payload = readTicketById(project.path, ticketId);
      if (payload.invalidId) {
        sendJson(res, 400, {
          generatedAt: new Date().toISOString(),
          project: projectSummary(project),
          rootDir: project.path,
          tickEnabled: payload.tickEnabled,
          ticket: null,
          popup: payload.popup,
          error: "Invalid ticket id.",
        });
        return;
      }

      if (!payload.ticket) {
        sendJson(res, 404, {
          generatedAt: new Date().toISOString(),
          project: projectSummary(project),
          rootDir: project.path,
          tickEnabled: payload.tickEnabled,
          ticket: null,
          popup: payload.popup,
          error: payload.tickEnabled
            ? `Ticket not found: ${ticketId}`
            : `tick is not initialized in project ${project.path} (${ISSUES_DIR_NAME} missing).`,
        });
        return;
      }

      sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        project: projectSummary(project),
        rootDir: project.path,
        tickEnabled: payload.tickEnabled,
        ticket: payload.ticket,
        popup: payload.popup,
      });
      return;
    }

    // Legacy single-project routes with optional ?project=<id>
    if (pathname === "/api/report") {
      const projectId = chooseProjectIdFromUrl(url, projects);
      const { project, error, code } = getProjectOrError(projectId, projects);
      if (!project) {
        sendJson(res, code, {
          generatedAt: new Date().toISOString(),
          error: projects.length === 0 ? "No attached projects." : error,
          tickEnabled: false,
          tickets: [],
          popup: null,
        });
        return;
      }
      const payload = readTickets(project.path);
      sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        project: projectSummary(project),
        rootDir: project.path,
        tickEnabled: payload.tickEnabled,
        tickets: payload.tickets,
        popup: payload.popup,
      });
      return;
    }

    if ((parts.length === 3 && parts[0] === "api" && parts[1] === "ticket") || pathname === "/api/ticket") {
      const ticketId = parts.length === 3 ? parts[2] : String(url.searchParams.get("id") || "").trim();
      const projectId = chooseProjectIdFromUrl(url, projects);
      const { project, error, code } = getProjectOrError(projectId, projects);
      if (!project) {
        sendJson(res, code, {
          generatedAt: new Date().toISOString(),
          error: projects.length === 0 ? "No attached projects." : error,
        });
        return;
      }

      if (method === "POST" || method === "PUT" || method === "PATCH") {
        try {
          const contentType = String(req.headers["content-type"] || "").toLowerCase();
          if (!contentType.includes("application/json")) {
            sendJson(res, 415, {
              generatedAt: new Date().toISOString(),
              project: projectSummary(project),
              error: "Content-Type must be application/json.",
            });
            return;
          }
          const body = await readJsonBody(req);
          const result = updateTicketById(project.path, ticketId, body);
          if (!result.ok) {
            sendJson(res, result.code, {
              generatedAt: new Date().toISOString(),
              project: projectSummary(project),
              error: result.error,
            });
            return;
          }
          sendJson(res, 200, {
            generatedAt: new Date().toISOString(),
            project: projectSummary(project),
            rootDir: project.path,
            tickEnabled: true,
            ticket: result.ticket,
            popup: result.popup,
          });
        } catch (err) {
          sendJson(res, 400, {
            generatedAt: new Date().toISOString(),
            project: projectSummary(project),
            error: err.message,
          });
        }
        return;
      }

      const payload = readTicketById(project.path, ticketId);
      if (!payload.ticket) {
        sendJson(res, 404, {
          generatedAt: new Date().toISOString(),
          project: projectSummary(project),
          rootDir: project.path,
          tickEnabled: payload.tickEnabled,
          ticket: null,
          popup: payload.popup,
          error: payload.invalidId ? "Invalid ticket id." : `Ticket not found: ${ticketId}`,
        });
        return;
      }
      sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        project: projectSummary(project),
        rootDir: project.path,
        tickEnabled: payload.tickEnabled,
        ticket: payload.ticket,
        popup: payload.popup,
      });
      return;
    }

    if (method === "GET" && useShadcnUi && pathname.startsWith("/assets/")) {
      if (tryServeWebDistAsset(pathname, res)) {
        return;
      }
    }

    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      res.end(buildLandingHtml(intervalMs, useShadcnUi));
      return;
    }

    if (parts.length === 2 && parts[0] === "project") {
      const projectId = parts[1];
      const selectedProject = getProjectById(projectId);
      res.writeHead(selectedProject ? 200 : 404, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      if (!selectedProject) {
        res.end("Project not found.\n");
        return;
      }
      res.end(buildProjectHtml(intervalMs, selectedProject, useShadcnUi));
      return;
    }

    if (parts.length === 4 && parts[0] === "project" && parts[2] === "ticket") {
      const projectId = parts[1];
      const ticketId = parts[3];
      const selectedProject = getProjectById(projectId);
      if (!selectedProject) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Project not found.\n");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      res.end(buildTicketHtml(intervalMs, selectedProject, ticketId, useShadcnUi));
      return;
    }

    if ((parts.length === 2 && parts[0] === "ticket") || pathname === "/ticket" || pathname === "/ticket.html") {
      const ticketId =
        (parts.length === 2 ? parts[1] : String(url.searchParams.get("id") || "").trim()) || "";
      const projectId = chooseProjectIdFromUrl(url, projects);
      const selectedProject = getProjectById(projectId);
      if (!selectedProject) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("No attached projects.\n");
        return;
      }
      if (!ticketId) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Missing ticket id.\n");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      res.end(buildTicketHtml(intervalMs, selectedProject, ticketId, useShadcnUi));
      return;
    }

    if (pathname === "/assets/tick-report.css") {
      serveStaticFile(res, CSS_PATH, "text/css; charset=utf-8");
      return;
    }

    if (pathname === "/assets/tick-report.js") {
      serveStaticFile(res, JS_PATH, "application/javascript; charset=utf-8");
      return;
    }

    if (pathname === "/assets/tick-ticket.js") {
      serveStaticFile(res, TICKET_JS_PATH, "application/javascript; charset=utf-8");
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, {
        generatedAt: new Date().toISOString(),
        error: `API route not found: ${pathname}`,
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found\n");
  });

  server.on("error", (err) => {
    process.stderr.write(`tick-report server error: ${err.message}\n`);
    clearDaemonMetaIfSelf();
    process.exit(1);
  });

  server.listen(port, host, () => {
    const projectCount = listProjects().length;
    process.stdout.write(`tick-report running at http://${host}:${port}\n`);
    process.stdout.write(`attached projects: ${projectCount}\n`);
    process.stdout.write(`ui mode: ${useShadcnUi ? "shadcn" : "legacy"}\n`);
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

module.exports = {
  createServer,
};
