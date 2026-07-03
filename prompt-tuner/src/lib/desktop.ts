/**
 * Thin wrapper over the Electron `desktop` bridge (see electron/preload.js).
 *
 * These replace the old /api/files/open-external and /api/files/open-location
 * HTTP routes, which built a shell command from a client-supplied path
 * (command-injection sink). The main process validates the path and uses
 * Electron's shell APIs — no shell string is ever constructed.
 *
 * When the bridge is absent (e.g. running the Next app in a plain browser via
 * `next dev`), these throw a clear "desktop app only" error so callers can
 * surface it instead of failing silently.
 */

interface DesktopBridge {
  openPath(filePath: string): Promise<{ ok: boolean; error?: string }>;
  revealPath(filePath: string): Promise<{ ok: boolean; error?: string }>;
}

function getBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { desktop?: DesktopBridge }).desktop ?? null;
}

/** True when running inside the Electron desktop shell. */
export function isDesktop(): boolean {
  return getBridge() !== null;
}

/** Open a file with its default OS application. */
export async function openPath(filePath: string): Promise<void> {
  const bridge = getBridge();
  if (!bridge) {
    throw new Error("Opening files is only available in the desktop app.");
  }
  const res = await bridge.openPath(filePath);
  if (!res?.ok) throw new Error(res?.error || "Failed to open file.");
}

/** Reveal a file in the OS file manager (Explorer/Finder). */
export async function revealPath(filePath: string): Promise<void> {
  const bridge = getBridge();
  if (!bridge) {
    throw new Error("Revealing files is only available in the desktop app.");
  }
  const res = await bridge.revealPath(filePath);
  if (!res?.ok) throw new Error(res?.error || "Failed to reveal file.");
}
