import type { SettingsProfile, SkyrimNetAgentType, ModelSlot } from "@/types/config";

const SKYRIMNET_AGENTS: SkyrimNetAgentType[] = [
  "default", "game_master", "memory_gen", "profile_gen", "action_eval", "meta_eval", "diary",
];

/**
 * Deterministic id/DOM-key for a quick-model, derived from its model name.
 *
 * buildQuickModelProfile() and the multichat streaming view MUST agree on this
 * exact string, or live streaming text maps to the wrong column (or none). It
 * lives here, once, so the two can never drift apart.
 */
export function quickModelId(modelName: string): string {
  return `quick-${modelName.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

/**
 * Build an ephemeral SettingsProfile from a model name string.
 * Copies all settings from the base profile but swaps the model name
 * for all SkyrimNet agents. The resulting profile can be passed directly
 * to runBenchmark or multichat execution.
 */
export function buildQuickModelProfile(
  modelName: string,
  baseProfile: SettingsProfile,
): SettingsProfile {
  // Generate a deterministic ID from the model name so it's stable across renders
  const id = quickModelId(modelName);

  // Deep-copy all slots from the base profile, replacing modelNames
  const slots = {} as Record<SkyrimNetAgentType, ModelSlot>;
  for (const agent of SKYRIMNET_AGENTS) {
    const baseSlot = baseProfile.slots[agent];
    if (baseSlot) {
      slots[agent] = {
        api: {
          ...baseSlot.api,
          modelNames: modelName,
        },
        tuning: { ...baseSlot.tuning },
      };
    }
  }

  return {
    id,
    name: modelName,
    createdAt: "",
    globalApiKey: baseProfile.globalApiKey,
    slots,
  };
}
