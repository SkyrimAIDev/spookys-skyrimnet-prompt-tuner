import type { AiTuningSettings } from "@/types/config";
import type { SettingsChange, PromptChange } from "@/types/autotuner";
import { normalizeParamKey } from "@/lib/constants/param-aliases";

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Apply settings changes to a copy of the working settings. Returns a new
 * AiTuningSettings object — does not mutate the input.
 */
export function applySettingsChanges(
  current: AiTuningSettings,
  changes: SettingsChange[],
): AiTuningSettings {
  const result = { ...current };

  for (const change of changes) {
    const key = normalizeParamKey(change.parameter);
    if (!(key in result)) continue;

    const currentVal = result[key];
    let newVal: typeof currentVal;

    if (typeof currentVal === "number") {
      newVal = Number(change.newValue);
      if (isNaN(newVal as number)) continue;
    } else if (typeof currentVal === "boolean") {
      newVal = change.newValue === true || change.newValue === "true";
    } else {
      newVal = String(change.newValue);
    }

    (result as Record<string, unknown>)[key] = newVal;
  }

  return result;
}

// ─── Path resolution (no LLM parsing) ────────────────────────────────────────

/**
 * Resolve the temp set's writable absolute base path. Cached per-call so
 * applyPromptChanges and prefetchOriginalContent only hit the API once.
 */
async function resolveTempBase(): Promise<string | null> {
  try {
    const resp = await fetch(`/api/files/resolve-prompt-set?name=${encodeURIComponent("__tuner_temp__")}`);
    if (!resp.ok) return null;
    const { basePath } = await resp.json();
    return (basePath as string).replace(/\\/g, "/");
  } catch {
    return null;
  }
}

/**
 * Read existing file content via the set-aware /api/files/read-prompt
 * endpoint, falling back through temp set → source set → originals so the
 * diff display always shows the prior state of the file.
 */
async function fetchExistingContent(
  relativePath: string,
  sourceSetName: string | undefined,
): Promise<string> {
  const fallbackSets: string[] = [];
  if (sourceSetName && sourceSetName !== "__tuner_temp__") fallbackSets.push(sourceSetName);
  fallbackSets.push("__original__");
  try {
    const resp = await fetch("/api/files/read-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relativePath,
        promptSet: "__tuner_temp__",
        fallbackSets,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      await debugLog("fetchExisting:result", {
        relativePath,
        resolvedFrom: data.resolvedFrom,
        contentLen: (data.content || "").length,
      });
      return data.content || "";
    }
    await debugLog("fetchExisting:notFound", { relativePath, status: resp.status });
  } catch (err) {
    await debugLog("fetchExisting:exception", { relativePath, err: (err as Error).message });
  }
  return "";
}

/**
 * Pre-populate `originalContent` on each change so the diff UI can render
 * the left panel immediately, before applyPromptChanges() finishes its
 * write loop. Returns a new array — does not mutate the input.
 *
 * Assumes change.filePath is already a canonical relative path (validated
 * upstream by enforcePromptEditingMode).
 */
export async function prefetchOriginalContent(
  changes: PromptChange[],
  sourceSetName?: string,
): Promise<PromptChange[]> {
  const out: PromptChange[] = [];
  for (const c of changes) {
    const originalContent = await fetchExistingContent(c.filePath, sourceSetName);
    out.push({ ...c, originalContent });
  }
  return out;
}

// ─── Apply ───────────────────────────────────────────────────────────────────

/**
 * Apply prompt changes by writing each modified file via the API.
 *
 * Contract:
 * - Every change.filePath MUST be a canonical relative path (e.g.
 *   "submodules/system_head/0010_setting.prompt"). Validation happens
 *   upstream in enforcePromptEditingMode.
 * - Every change is a full-file replacement: searchText is ignored.
 * - The function reads each file's prior content for the diff display, then
 *   writes change.replaceText to the temp set.
 *
 * @param changes        Pre-validated changes to apply.
 * @param sourceSetName  Active set name — used as a fallback when reading
 *                       the prior content for the diff display.
 */
export async function applyPromptChanges(
  changes: PromptChange[],
  sourceSetName?: string,
): Promise<PromptChange[]> {
  const applied: PromptChange[] = [];
  const tempBase = await resolveTempBase();
  await debugLog("applyPromptChanges:start", {
    changeCount: changes.length,
    sourceSetName,
    tempBase,
  });

  if (!tempBase) {
    // No writable target — surface this clearly so the report explains the failure.
    return changes.map((c) => ({
      ...c,
      modifiedContent: "",
      reason: `[SKIPPED] Could not resolve temp tuner set. ${c.reason}`,
    }));
  }

  for (const change of changes) {
    const relativePath = change.filePath;
    const absolutePath = `${tempBase}/${relativePath}`;
    await debugLog("change:start", { relativePath, absolutePath, replaceTextLen: change.replaceText?.length ?? 0 });

    const existingContent = await fetchExistingContent(relativePath, sourceSetName);

    const writeResp = await fetch("/api/files/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: absolutePath, content: change.replaceText }),
    });
    await debugLog("change:writeResult", { absolutePath, status: writeResp.status, ok: writeResp.ok });

    if (!writeResp.ok) {
      const errBody = await writeResp.text().catch(() => "");
      await debugLog("change:writeFailedBody", { status: writeResp.status, body: errBody.slice(0, 500) });
      applied.push({
        ...change,
        originalContent: existingContent,
        modifiedContent: "",
        reason: `[SKIPPED] Failed to write file: HTTP ${writeResp.status}. ${change.reason}`,
      });
      continue;
    }

    applied.push({
      ...change,
      originalContent: existingContent,
      modifiedContent: change.replaceText,
    });
  }

  return applied;
}

// ─── Debug logging ───────────────────────────────────────────────────────────

/**
 * Fire-and-forget debug logger. Mirrors to the browser console and appends
 * a line to {editedPromptsDir}/tuner-debug.log via /api/debug/log so testers
 * can ship the file when reporting issues. Best-effort — never throws.
 */
async function debugLog(tag: string, data: unknown): Promise<void> {
  try {
    // eslint-disable-next-line no-console
    console.log(`[apply-changes] ${tag}`, data);
  } catch { /* ignore */ }
  try {
    await fetch("/api/debug/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag, data }),
    });
  } catch { /* ignore */ }
}
