"use strict";
// Preload script. The app is a local web server, so almost everything talks HTTP
// and no IPC bridge is needed — EXCEPT native shell actions (open / reveal a
// file), which must not go through a server route that shells out. Expose a
// minimal, path-validated bridge for those instead.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  // Open a file with its default OS application. Resolves to { ok, error? }.
  openPath: (filePath) => ipcRenderer.invoke("desktop:openPath", filePath),
  // Reveal a file in the OS file manager. Resolves to { ok, error? }.
  revealPath: (filePath) => ipcRenderer.invoke("desktop:revealPath", filePath),
});

// OS-backed encryption for secrets at rest (API keys in localStorage).
contextBridge.exposeInMainWorld("secrets", {
  // Resolves true when the OS credential store is usable.
  available: () => ipcRenderer.invoke("secrets:available"),
  // Encrypt a string → base64 ciphertext (or null if unavailable).
  encrypt: (plaintext) => ipcRenderer.invoke("secrets:encrypt", plaintext),
  // Decrypt base64 ciphertext → string (or null on failure).
  decrypt: (b64) => ipcRenderer.invoke("secrets:decrypt", b64),
});
