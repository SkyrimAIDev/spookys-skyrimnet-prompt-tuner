export interface ParsedAction {
  name: string;
  params: Record<string, string>;
}

function toStringMap(obj: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v !== null && v !== undefined) {
        out[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
    }
  }
  return out;
}

/**
 * Parse the chosen action from a `native_action_selector` (action_eval) response.
 *
 * The template permits two one-line formats (native_action_selector.prompt:11-22):
 *   JSON:  {"ACTION": "Name", "PARAMS": {"k": "v"}}
 *   Text:  ACTION: Name PARAMS: {"k": "v"}
 * plus `ACTION: None` / `{"ACTION": "None"}` when nothing fits.
 *
 * Returns `{ name, params }` for a real action, or `null` for None / no match.
 *
 * The previous parser used only `/ACTION:\s*(\w+)/`, which silently dropped
 * PARAMS *and* failed to match the JSON form at all (the `"` after the colon
 * breaks `\w+`), registering JSON-format replies as "None".
 */
export function parseSelectedAction(
  response: string | undefined | null,
): ParsedAction | null {
  if (!response) return null;
  const trimmed = response
    .trim()
    .replace(/^```json?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  // Format 1 — a JSON object carrying an ACTION key.
  const jsonMatch = trimmed.match(/\{[\s\S]*?"ACTION"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as { ACTION?: unknown; PARAMS?: unknown };
      const name = obj.ACTION != null ? String(obj.ACTION).trim() : "";
      if (name && name.toLowerCase() !== "none") {
        return { name, params: toStringMap(obj.PARAMS) };
      }
      return null;
    } catch {
      // malformed JSON — fall through to the text form
    }
  }

  // Format 2 — text "ACTION: Name [PARAMS: {json}]".
  const nameMatch = trimmed.match(/ACTION:\s*(\w+)/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  if (name.toLowerCase() === "none") return null;

  let params: Record<string, string> = {};
  const paramsMatch = trimmed.match(/PARAMS:\s*(\{[\s\S]*\})/);
  if (paramsMatch) {
    try {
      params = toStringMap(JSON.parse(paramsMatch[1]));
    } catch {
      // ignore unparseable params — still report the action name
    }
  }
  return { name, params };
}
