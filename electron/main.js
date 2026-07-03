"use strict";

const { app, BrowserWindow, shell, ipcMain, safeStorage } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

const isDev = !app.isPackaged;
const PORT = 3737;

// ── Resolve runtime paths ────────────────────────────────────────────────────
//
// DATA_DIR   — writable user data (edited-prompts, etc.). Survives updates.
//   Dev:      project root  (one level above electron/)
//   Packaged: data/ folder next to the exe
//
// RESOURCES_DIR — bundled read-only assets (Next.js server, reference-docs).
//   Dev:      project root
//   Packaged: Electron's process.resourcesPath

const exeDir =
  process.env.PORTABLE_EXECUTABLE_DIR || // portable .exe target
  path.dirname(app.getPath("exe"));       // zip/dir target

const DATA_DIR = isDev
  ? path.resolve(__dirname, "..")
  : path.join(exeDir, "data");

const RESOURCES_DIR = isDev
  ? path.resolve(__dirname, "..")
  : process.resourcesPath;

// Next.js standalone server
const SERVER_DIR = isDev
  ? path.join(__dirname, "..", "prompt-tuner", ".next", "standalone")
  : path.join(RESOURCES_DIR, "server");

const SERVER_ENTRY = path.join(SERVER_DIR, "server.js");

// Original SkyrimNet prompts (bundled read-only)
const ORIGINALS_DIR = path.join(
  RESOURCES_DIR,
  "reference-docs",
  "original-prompts"
);

// ── Native file actions (IPC) ────────────────────────────────────────────────
//
// Opening / revealing files in the OS shell used to go through HTTP API routes
// that built a cmd.exe command string — a command-injection sink. These handlers
// replace that: the renderer calls them over contextIsolated IPC, and we use
// Electron's shell APIs (no shell string, no interpolation). Paths are still
// confined to the app's own directories with a separator-boundary check.

const EDITED_PROMPTS_DIR = path.join(DATA_DIR, "edited-prompts");
const REFERENCE_DOCS_DIR = path.dirname(ORIGINALS_DIR);

function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  // Inside `parent` iff the relative path doesn't climb out (..) and isn't absolute.
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isPathAllowedMain(filePath) {
  if (typeof filePath !== "string" || !filePath) return false;
  const resolved = path.resolve(filePath);
  return (
    isWithin(resolved, ORIGINALS_DIR) ||
    isWithin(resolved, EDITED_PROMPTS_DIR) ||
    isWithin(resolved, REFERENCE_DOCS_DIR)
  );
}

function registerIpcHandlers() {
  // Open a file with its default application.
  ipcMain.handle("desktop:openPath", async (_event, filePath) => {
    if (!isPathAllowedMain(filePath)) return { ok: false, error: "Access denied" };
    const err = await shell.openPath(path.resolve(filePath)); // "" on success
    return err ? { ok: false, error: err } : { ok: true };
  });

  // Reveal a file in the OS file manager (Explorer/Finder).
  ipcMain.handle("desktop:revealPath", async (_event, filePath) => {
    if (!isPathAllowedMain(filePath)) return { ok: false, error: "Access denied" };
    shell.showItemInFolder(path.resolve(filePath));
    return { ok: true };
  });

  // ── Secret encryption at rest (safeStorage / OS keychain) ──────────────────
  // The renderer stores API keys in localStorage. These let it seal that blob
  // with the OS credential store (DPAPI on Windows) so keys aren't sitting on
  // disk in plaintext. If encryption isn't available, encrypt returns null and
  // the renderer falls back to plaintext (same as before).
  ipcMain.handle("secrets:available", () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  });

  ipcMain.handle("secrets:encrypt", (_event, plaintext) => {
    if (typeof plaintext !== "string") return null;
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.encryptString(plaintext).toString("base64");
    } catch {
      return null;
    }
  });

  ipcMain.handle("secrets:decrypt", (_event, b64) => {
    if (typeof b64 !== "string") return null;
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(b64, "base64"));
    } catch {
      return null;
    }
  });
}

// ── Start Next.js server (runs in main process) ──────────────────────────────
function startServer() {
  // Ensure user data directories exist on first run
  fs.mkdirSync(path.join(DATA_DIR, "edited-prompts"), { recursive: true });

  // Set env vars that paths.ts reads at server startup
  process.env.SKYRIMNET_DATA_DIR = DATA_DIR;
  process.env.SKYRIMNET_ORIGINALS_DIR = ORIGINALS_DIR;
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.NODE_ENV = "production";
  process.env.NEXT_TELEMETRY_DISABLED = "1";

  // Next.js standalone server requires cwd = its own directory
  process.chdir(SERVER_DIR);

  // Start server directly in main process (Electron IS Node.js)
  require(SERVER_ENTRY);
}

// ── Wait for server to accept connections ────────────────────────────────────
function waitForServer(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      http
        .get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
          if (res.statusCode < 500) {
            resolve();
          } else if (Date.now() < deadline) {
            setTimeout(attempt, 400);
          } else {
            reject(new Error("Server startup timed out"));
          }
        })
        .on("error", () => {
          if (Date.now() < deadline) setTimeout(attempt, 400);
          else reject(new Error("Server startup timed out"));
        });
    };
    // Give the server a moment to bind before first poll
    setTimeout(attempt, 800);
  });
}

// ── Create browser window ────────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, "assets", "icon.ico");
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    title: "Spooky's SkyrimNet Prompt Tuner",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Keep timers/JS running at full speed when the window is in the
      // background — otherwise long tuning runs throttle to ~1Hz on minimize.
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadURL(`http://127.0.0.1:${PORT}`);

  // Open target=_blank links in the system browser — but only real web URLs.
  // Never hand file:/other schemes to the OS, which shell.openExternal would
  // launch (e.g. a local executable) from untrusted rendered content.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url);
      if (protocol === "https:" || protocol === "http:") {
        shell.openExternal(url);
      }
    } catch {
      // Malformed URL — ignore.
    }
    return { action: "deny" };
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  registerIpcHandlers();
  try {
    startServer();
  } catch (err) {
    console.error("Server failed to start:", err);
  }
  try {
    await waitForServer();
  } catch (err) {
    console.error("Server not responding:", err);
  }
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
