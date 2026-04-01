import type { AiTuningSettings } from "@/types/config";

/** Maps snake_case LLM parameter names to camelCase store keys. */
export const PARAM_ALIASES: Record<string, keyof AiTuningSettings> = {
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

/** Normalize a parameter key from snake_case to camelCase if known. */
export function normalizeParamKey(key: string): keyof AiTuningSettings {
  return (PARAM_ALIASES[key] || key) as keyof AiTuningSettings;
}
