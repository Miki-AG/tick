"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { ISSUES_DIR_NAME } = require("./constants");
const { updateTicketById } = require("./ticket-editor");
const { readTicketById, readTickets } = require("./tickets");
const { renderTemplate } = require("./template");
const {
  attachProject,
  clearDaemonMetaIfSelf,
  detachProjectById,
  getProjectById,
  listProjects,
} = require("./global-state");

const FILES_DIR = path.join(__dirname, "..", "files");
const INDEX_TEMPLATE_PATH = path.join(FILES_DIR, "index.ejs");
const TICKET_TEMPLATE_PATH = path.join(FILES_DIR, "ticket.ejs");
const CSS_PATH = path.join(FILES_DIR, "tick-report.css");
const JS_PATH = path.join(FILES_DIR, "tick-report.js");
const TICKET_JS_PATH = path.join(FILES_DIR, "tick-ticket.js");
const MAX_JSON_BODY_BYTES = 1024 * 1024;

function decodeSegment(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (err) {
    return null;
  }
}

function buildIndexHtml(intervalMs, mode, selectedProjectId) {
  return renderTemplate(INDEX_TEMPLATE_PATH, {
    intervalMs,
    mode,
    configJson: JSON.stringify({ pollMs: intervalMs, mode, selectedProjectId }),
  });
}

function buildTicketHtml(intervalMs, project, ticketId) {
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

function serveStaticFile(res, filePath, contentType) {
  try {
    const body = fs.readFileSync(filePath, "utf8");
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Unable to load asset: ${path.basename(filePath)}\n`);
  }
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

    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      res.end(buildIndexHtml(intervalMs, "landing", null));
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
      res.end(buildIndexHtml(intervalMs, "project", projectId));
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
      res.end(buildTicketHtml(intervalMs, selectedProject, ticketId));
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
      res.end(buildTicketHtml(intervalMs, selectedProject, ticketId));
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
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

module.exports = {
  createServer,
};
