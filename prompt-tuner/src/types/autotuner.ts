import type { AiTuningSettings } from "./config";
import type { BenchmarkCategory, BenchmarkSubtaskResult } from "./benchmark";
import type { ChatMessage } from "./llm";

export type TuningTarget = "prompts" | "settings" | "both";

/**
 * Controls which prompts the tuner is allowed to edit:
 * - recommended: only the best prompts for the current agent (default)
 * - new_prompt: LLM creates a new prompt file only, no editing existing
 * - auto: LLM decides which files to edit or whether to create new ones
 * - custom: user-selected specific prompt files
 */
export type PromptEditingMode = "recommended" | "new_prompt" | "auto" | "custom";

export type TunerPhase =
  | "idle"
  | "benchmarking"
  | "explaining"
  | "assessing"
  | "proposing"
  | "applying"
  | "complete"
  | "error"
  | "stopped";

export interface SettingsChange {
  parameter: keyof AiTuningSettings;
  oldValue: string | number | boolean;
  newValue: string | number | boolean;
  reason: string;
}

export interface PromptChange {
  filePath: string;
  searchText: string;
  replaceText: string;
  originalContent: string;
  modifiedContent: string;
  reason: string;
}

export interface TunerProposal {
  stopTuning: boolean;
  stopReason?: string;
  settingsChanges: SettingsChange[];
  promptChanges: PromptChange[];
  reasoning: string;
}

export interface TunerTurnResult {
  label: string;
  messages: ChatMessage[];
  response: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface TunerRound {
  roundNumber: number;
  benchmarkResult: BenchmarkSubtaskResult | null;
  turnResults?: TunerTurnResult[];
  explanationMessages?: ChatMessage[];
  assessmentMessages?: ChatMessage[];
  assessmentText: string;
  proposalMessages?: ChatMessage[];
  proposal: TunerProposal | null;
  proposalRaw: string;
  appliedSettings: AiTuningSettings | null;
  phase: TunerPhase;
  error?: string;
}

export interface AutoTunerConfig {
  selectedProfileId: string;
  selectedCategory: BenchmarkCategory | null;
  selectedScenarioId: string;
  selectedPromptSet: string;
  tuningTarget: TuningTarget;
  promptEditingMode: PromptEditingMode;
  /** Paths selected by user in "custom" mode (relative to prompt set base) */
  customPromptPaths: string[];
  maxRounds: number;
  lockedSettings: (keyof AiTuningSettings)[];
  customInstructions: string;
}
