"use strict";

const fs = require("fs");
const path = require("path");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compileEjs(source) {
  let code = "";
  let cursor = 0;
  const matcher = /<%([=-]?)([\s\S]+?)%>/g;
  let match;

  while ((match = matcher.exec(source)) !== null) {
    const text = source.slice(cursor, match.index);
    if (text) {
      code += `__out += ${JSON.stringify(text)};\n`;
    }

    const marker = match[1];
    const body = match[2].trim();
    if (marker === "=") {
      code += `__out += __escape(${body});\n`;
    } else if (marker === "-") {
      code += `__out += (${body});\n`;
    } else {
      code += `${body}\n`;
    }
    cursor = match.index + match[0].length;
  }

  const tail = source.slice(cursor);
  if (tail) {
    code += `__out += ${JSON.stringify(tail)};\n`;
  }

  const wrapped = `let __out = "";\nwith (__locals) {\n${code}}\nreturn __out;\n`;
  // eslint-disable-next-line no-new-func
  return new Function("__locals", "__escape", wrapped);
}

const templateCache = new Map();

function getCompiledTemplate(templatePath) {
  const stat = fs.statSync(templatePath);
  const cached = templateCache.get(templatePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.fn;
  }
  const source = fs.readFileSync(templatePath, "utf8");
  const fn = compileEjs(source);
  templateCache.set(templatePath, { mtimeMs: stat.mtimeMs, fn });
  return fn;
}

function renderTemplate(templatePath, locals = {}) {
  const resolvedPath = path.resolve(templatePath);
  const mergedLocals = { ...locals };

  mergedLocals.include = (relativePath, includeLocals = {}) => {
    const includePath = path.resolve(path.dirname(resolvedPath), relativePath);
    return renderTemplate(includePath, { ...locals, ...includeLocals });
  };

  const templateFn = getCompiledTemplate(resolvedPath);
  return templateFn(mergedLocals, escapeHtml);
}

module.exports = {
  renderTemplate,
};
