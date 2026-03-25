import type { TunerProposal, SettingsChange, PromptChange } from "@/types/autotuner";
import type { AiTuningSettings } from "@/types/config";

/** Normalize snake_case parameter names to camelCase store keys. */
const PARAM_ALIASES: Record<string, keyof AiTuningSettings> = {
  max_tokens: "maxTokens",
  top_p: "topP",
  top_k: "topK",
  frequency_penalty: "frequencyPenalty",
  presence_penalty: "presencePenalty",
  stop_sequences: "stopSequences",
  structured_outputs: "structuredOutputs",
  allow_reasoning: "allowReasoning",
  reasoning_effort: "reasoningEffort",
};

function normalizeParam(key: string): string {
  return PARAM_ALIASES[key] || key;
}

/**
 * Parse the tuner LLM's JSON response into a TunerProposal.
 * Handles code fences, trailing commas, and other common LLM JSON issues.
 */
export function parseProposal(raw: string): TunerProposal {
  // Strip code fences
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try to extract JSON by finding the outermost valid JSON object.
  // The LLM sometimes outputs prose analysis before the JSON.
  let parsed: Record<string, unknown> | null = null;

  // Strategy 1: try parsing the whole cleaned string
  try {
    const stripped = cleaned.replace(/,\s*([}\]])/g, "$1");
    parsed = JSON.parse(stripped);
  } catch {
    // Strategy 2: find each '{' and try parsing from there to the end
    for (let i = 0; i < cleaned.length && !parsed; i++) {
      if (cleaned[i] !== "{") continue;
      // Try from this '{' to the last '}' in the remaining text
      const remaining = cleaned.slice(i);
      const lastBrace = remaining.lastIndexOf("}");
      if (lastBrace === -1) continue;
      const candidate = remaining.slice(0, lastBrace + 1).replace(/,\s*([}\]])/g, "$1");
      try {
        const obj = JSON.parse(candidate);
        if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
          parsed = obj;
        }
      } catch {
        // Try next '{'
      }
    }
  }

  if (!parsed) {
    throw new Error(`Failed to parse proposal JSON: ${raw.substring(0, 200)}`);
  }

  const stopTuning = Boolean(parsed.stop_tuning ?? parsed.stopTuning ?? false);
  const stopReason = (parsed.stop_reason ?? parsed.stopReason ?? undefined) as string | undefined;
  const reasoning = (parsed.reasoning ?? "") as string;

  const settingsChanges: SettingsChange[] = [];
  const rawSettings = parsed.settings_changes ?? parsed.settingsChanges;
  if (Array.isArray(rawSettings)) {
    for (const sc of rawSettings) {
      if (sc && typeof sc === "object" && "parameter" in sc) {
        settingsChanges.push({
          parameter: normalizeParam(sc.parameter) as keyof AiTuningSettings,
          oldValue: sc.old_value ?? sc.oldValue ?? "",
          newValue: sc.new_value ?? sc.newValue ?? "",
          reason: sc.reason ?? "",
        });
      }
    }
  }

  const promptChanges: PromptChange[] = [];
  const rawPrompts = parsed.prompt_changes ?? parsed.promptChanges;
  if (Array.isArray(rawPrompts)) {
    for (const pc of rawPrompts) {
      if (pc && typeof pc === "object" && "file_path" in pc) {
        promptChanges.push({
          filePath: pc.file_path ?? pc.filePath ?? "",
          searchText: pc.search_text ?? pc.searchText ?? "",
          replaceText: pc.replace_text ?? pc.replaceText ?? "",
          originalContent: "",
          modifiedContent: "",
          reason: pc.reason ?? "",
        });
      }
    }
  }

  return { stopTuning, stopReason, settingsChanges, promptChanges, reasoning };
}
