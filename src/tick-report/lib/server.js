"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { ISSUES_DIR_NAME } = require("./constants");
const { updateTicketById } = require("./ticket-editor");
const { readTicketById, readTickets } = require("./tickets");
const { renderTemplate } = require("./template");
const { clearPidMetaIfSelf } = require("./process-control");

const FILES_DIR = path.join(__dirname, "..", "files");
const INDEX_TEMPLATE_PATH = path.join(FILES_DIR, "index.ejs");
const TICKET_TEMPLATE_PATH = path.join(FILES_DIR, "ticket.ejs");
const CSS_PATH = path.join(FILES_DIR, "tick-report.css");
const JS_PATH = path.join(FILES_DIR, "tick-report.js");
const TICKET_JS_PATH = path.join(FILES_DIR, "tick-ticket.js");
const MAX_JSON_BODY_BYTES = 1024 * 1024;

function buildIndexHtml(intervalMs, rootDir) {
  return renderTemplate(INDEX_TEMPLATE_PATH, {
    intervalMs,
    rootDir,
    configJson: JSON.stringify({ pollMs: intervalMs, rootDir }),
  });
}

function buildTicketHtml(intervalMs, rootDir, ticketId) {
  return renderTemplate(TICKET_TEMPLATE_PATH, {
    intervalMs,
    rootDir,
    ticketId,
    configJson: JSON.stringify({ pollMs: intervalMs, rootDir, ticketId }),
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

function extractTicketId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  if (!raw || raw.includes("/")) return null;
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    return null;
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

function createServer(port, intervalMs, host = "127.0.0.1") {
  const rootDir = process.cwd();
  let server;

  function shutdown(code = 0) {
    if (!server) {
      clearPidMetaIfSelf(rootDir);
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
      clearPidMetaIfSelf(rootDir);
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
      clearPidMetaIfSelf(rootDir);
      process.exit(code);
    });
  }

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const ticketPathId = extractTicketId(url.pathname, "/ticket/");
    const ticketApiPathId = extractTicketId(url.pathname, "/api/ticket/");

    if (url.pathname === "/api/report") {
      const payload = readTickets(rootDir);
      sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        rootDir,
        tickEnabled: payload.tickEnabled,
        tickets: payload.tickets,
        popup: payload.popup,
      });
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      res.end(buildIndexHtml(intervalMs, rootDir));
      return;
    }

    if (
      ticketPathId !== null ||
      url.pathname === "/ticket" ||
      url.pathname === "/ticket.html"
    ) {
      const ticketId = ticketPathId || String(url.searchParams.get("id") || "").trim();
      if (!ticketId) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Missing ticket id.\n");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      res.end(buildTicketHtml(intervalMs, rootDir, ticketId));
      return;
    }

    if (ticketApiPathId !== null || url.pathname === "/api/ticket") {
      const ticketId = ticketApiPathId || String(url.searchParams.get("id") || "").trim();
      if (req.method === "POST" || req.method === "PUT") {
        try {
          const contentType = String(req.headers["content-type"] || "").toLowerCase();
          if (!contentType.includes("application/json")) {
            sendJson(res, 415, {
              generatedAt: new Date().toISOString(),
              rootDir,
              error: "Content-Type must be application/json.",
            });
            return;
          }
          const body = await readJsonBody(req);
          const result = updateTicketById(rootDir, ticketId, body);
          if (!result.ok) {
            sendJson(res, result.code, {
              generatedAt: new Date().toISOString(),
              rootDir,
              error: result.error,
            });
            return;
          }
          sendJson(res, 200, {
            generatedAt: new Date().toISOString(),
            rootDir,
            tickEnabled: true,
            ticket: result.ticket,
            popup: result.popup,
          });
          return;
        } catch (err) {
          sendJson(res, 400, {
            generatedAt: new Date().toISOString(),
            rootDir,
            error: err.message,
          });
          return;
        }
      }

      const payload = readTicketById(rootDir, ticketId);
      if (payload.invalidId) {
        sendJson(res, 400, {
          generatedAt: new Date().toISOString(),
          rootDir,
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
          rootDir,
          tickEnabled: payload.tickEnabled,
          ticket: null,
          popup: payload.popup,
          error: payload.tickEnabled
            ? `Ticket not found: ${ticketId}`
            : "tick is not initialized in this folder.",
        });
        return;
      }

      sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        rootDir,
        tickEnabled: payload.tickEnabled,
        ticket: payload.ticket,
        popup: payload.popup,
      });
      return;
    }

    if (url.pathname === "/assets/tick-report.css") {
      serveStaticFile(res, CSS_PATH, "text/css; charset=utf-8");
      return;
    }

    if (url.pathname === "/assets/tick-report.js") {
      serveStaticFile(res, JS_PATH, "application/javascript; charset=utf-8");
      return;
    }

    if (url.pathname === "/assets/tick-ticket.js") {
      serveStaticFile(res, TICKET_JS_PATH, "application/javascript; charset=utf-8");
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found\n");
  });

  server.on("error", (err) => {
    process.stderr.write(`tick-report server error: ${err.message}\n`);
    clearPidMetaIfSelf(rootDir);
    process.exit(1);
  });

  server.listen(port, host, () => {
    process.stdout.write(`tick-report running at http://${host}:${port}\n`);
    process.stdout.write(`watching: ${path.join(rootDir, ISSUES_DIR_NAME)}\n`);
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

module.exports = {
  createServer,
};
