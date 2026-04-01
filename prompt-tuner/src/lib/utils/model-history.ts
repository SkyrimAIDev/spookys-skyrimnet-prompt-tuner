const STORAGE_KEY = "skyrimnet-model-history";
const MAX_HISTORY = 30;

function load(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function save(models: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(models.slice(0, MAX_HISTORY)));
}

/** Add a model to the front of history (most recent first). Deduplicates. */
export function addToModelHistory(model: string) {
  const trimmed = model.trim();
  if (!trimmed) return;
  const current = load();
  const updated = [trimmed, ...current.filter((m) => m !== trimmed)];
  save(updated);
}

/** Get all models in history (most recent first). */
export function getModelHistory(): string[] {
  return load();
}

/** Get models matching a query (case-insensitive, most recent first). */
export function searchModelHistory(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return load();
  return load().filter((m) => m.toLowerCase().includes(q));
}

/** Remove a single model from history. */
export function removeFromModelHistory(model: string) {
  save(load().filter((m) => m !== model));
}

/** Clear entire history. */
export function clearModelHistory() {
  save([]);
}
