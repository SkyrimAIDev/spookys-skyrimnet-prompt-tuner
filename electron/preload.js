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
