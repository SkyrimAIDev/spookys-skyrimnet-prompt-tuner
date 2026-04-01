import { create } from "zustand";
import type { BenchmarkCategory } from "@/types/benchmark";
import type { AiTuningSettings } from "@/types/config";
import type { AiTuningSettings as AiTuningSettingsType } from "@/types/config";
import type {
  TuningTarget,
  PromptEditingMode,
  TunerPhase,
  TunerRound,
  TunerProposal,
  TunerTurnResult,
} from "@/types/autotuner";
import type { BenchmarkSubtaskResult } from "@/types/benchmark";

const STORAGE_KEY = "skyrimnet-autotuner";

function loadPersisted(): {
  selectedProfileId: string;
  selectedCategory: BenchmarkCategory | null;
  selectedScenarioId: string;
  selectedPromptSet: string;
  tuningTarget: TuningTarget;
  promptEditingMode: PromptEditingMode;
  customPromptPaths: string[];
  maxRounds: number;
  lockedSettings: (keyof AiTuningSettingsType)[];
  customInstructions: string;
  ignoreFormatScoring: boolean;
  isNarrationEnabled: boolean;
} {
  const defaults = {
    selectedProfileId: "",
    selectedCategory: null as BenchmarkCategory | null,
    selectedScenarioId: "",
    selectedPromptSet: "__active__",
    tuningTarget: "settings" as TuningTarget,
    promptEditingMode: "recommended" as PromptEditingMode,
    customPromptPaths: [] as string[],
    maxRounds: 5,
    lockedSettings: ["maxTokens", "allowReasoning", "reasoningEffort", "structuredOutputs", "stopSequences"] as (keyof AiTuningSettingsType)[],
    customInstructions: "",
    ignoreFormatScoring: true,
    isNarrationEnabled: true,
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        selectedProfileId: data.selectedProfileId ?? "",
        selectedCategory: data.selectedCategory ?? null,
        selectedScenarioId: data.selectedScenarioId ?? "",
        selectedPromptSet: data.selectedPromptSet ?? "__active__",
        tuningTarget: data.tuningTarget ?? "settings",
        promptEditingMode: data.promptEditingMode ?? "recommended",
        customPromptPaths: data.customPromptPaths ?? [],
        maxRounds: data.maxRounds ?? 5,
        lockedSettings: data.lockedSettings ?? ["maxTokens", "allowReasoning", "reasoningEffort"],
        customInstructions: data.customInstructions ?? "",
        ignoreFormatScoring: data.ignoreFormatScoring ?? true,
        isNarrationEnabled: data.isNarrationEnabled ?? true,
      };
    }
  } catch { /* ignore */ }
  return defaults;
}

interface AutoTunerState {
  // Config (persisted)
  selectedProfileId: string;
  selectedCategory: BenchmarkCategory | null;
  selectedScenarioId: string;
  selectedPromptSet: string;
  tuningTarget: TuningTarget;
  promptEditingMode: PromptEditingMode;
  customPromptPaths: string[];
  maxRounds: number;
  lockedSettings: (keyof AiTuningSettingsType)[];
  customInstructions: string;
  ignoreFormatScoring: boolean;
  isNarrationEnabled: boolean;

  // Run state (volatile)
  isRunning: boolean;
  currentRound: number;
  phase: TunerPhase;
  rounds: TunerRound[];
  abortController: AbortController | null;

  // Working state
  workingSettings: AiTuningSettings | null;
  originalSettings: AiTuningSettings | null;
  workingPromptSet: string;

  // Streaming
  explanationStream: string;
  assessmentStream: string;
  proposalStream: string;
  statusMessage: string;

  // Session summary & post-tuning chat
  sessionSummary: string;
  summaryStream: string;
  postTuningMessages: { role: "user" | "assistant"; content: string }[];
  postTuningStream: string;
  isPostTuningStreaming: boolean;

  // Actions - config
  setSelectedProfileId: (id: string) => void;
  setSelectedCategory: (cat: BenchmarkCategory | null) => void;
  setSelectedScenarioId: (id: string) => void;
  setSelectedPromptSet: (name: string) => void;
  setTuningTarget: (target: TuningTarget) => void;
  setPromptEditingMode: (mode: PromptEditingMode) => void;
  setCustomPromptPaths: (paths: string[]) => void;
  setMaxRounds: (n: number) => void;
  setLockedSettings: (keys: (keyof AiTuningSettingsType)[]) => void;
  setCustomInstructions: (text: string) => void;
  setIgnoreFormatScoring: (ignore: boolean) => void;
  setIsNarrationEnabled: (enabled: boolean) => void;

  // Actions - run state
  setIsRunning: (running: boolean) => void;
  setPhase: (phase: TunerPhase) => void;
  setCurrentRound: (n: number) => void;
  setAbortController: (ctrl: AbortController | null) => void;

  // Actions - working state
  setWorkingSettings: (settings: AiTuningSettings | null) => void;
  setOriginalSettings: (settings: AiTuningSettings | null) => void;
  setWorkingPromptSet: (name: string) => void;

  // Actions - rounds
  startNewRound: (roundNumber: number) => void;
  updateCurrentRound: (updates: Partial<TunerRound>) => void;
  setRoundBenchmarkResult: (roundIdx: number, result: BenchmarkSubtaskResult) => void;
  setRoundAssessment: (roundIdx: number, text: string) => void;
  setRoundProposal: (roundIdx: number, proposal: TunerProposal, raw: string) => void;
  setRoundPhase: (roundIdx: number, phase: TunerPhase) => void;
  setRoundError: (roundIdx: number, error: string) => void;
  setRoundAppliedSettings: (roundIdx: number, settings: AiTuningSettings) => void;
  setRoundTurnResults: (roundIdx: number, turnResults: TunerTurnResult[]) => void;
  addRoundTurnResult: (roundIdx: number, turnResult: TunerTurnResult) => void;

  // Actions - streaming
  appendExplanationStream: (chunk: string) => void;
  appendAssessmentStream: (chunk: string) => void;
  appendProposalStream: (chunk: string) => void;
  setStatusMessage: (msg: string) => void;
  clearStreams: () => void;

  // Actions - summary & post-tuning chat
  setSessionSummary: (text: string) => void;
  appendSummaryStream: (chunk: string) => void;
  addPostTuningMessage: (msg: { role: "user" | "assistant"; content: string }) => void;
  appendPostTuningStream: (chunk: string) => void;
  setIsPostTuningStreaming: (streaming: boolean) => void;
  clearPostTuningStream: () => void;

  // Actions - lifecycle
  reset: () => void;
  persist: () => void;
}

const _persisted = loadPersisted();

export const useAutoTunerStore = create<AutoTunerState>((set, get) => ({
  // Config
  selectedProfileId: _persisted.selectedProfileId,
  selectedCategory: _persisted.selectedCategory,
  selectedScenarioId: _persisted.selectedScenarioId,
  selectedPromptSet: _persisted.selectedPromptSet,
  tuningTarget: _persisted.tuningTarget,
  promptEditingMode: _persisted.promptEditingMode,
  customPromptPaths: _persisted.customPromptPaths,
  maxRounds: _persisted.maxRounds,
  lockedSettings: _persisted.lockedSettings,
  customInstructions: _persisted.customInstructions,
  ignoreFormatScoring: _persisted.ignoreFormatScoring,
  isNarrationEnabled: _persisted.isNarrationEnabled,

  // Run state
  isRunning: false,
  currentRound: 0,
  phase: "idle",
  rounds: [],
  abortController: null,

  // Working state
  workingSettings: null,
  originalSettings: null,
  workingPromptSet: "",

  // Streaming
  explanationStream: "",
  assessmentStream: "",
  proposalStream: "",
  statusMessage: "",

  // Session summary & post-tuning chat
  sessionSummary: "",
  summaryStream: "",
  postTuningMessages: [],
  postTuningStream: "",
  isPostTuningStreaming: false,

  // Config actions
  setSelectedProfileId: (id) => {
    set({ selectedProfileId: id });
    get().persist();
  },
  setSelectedCategory: (cat) => {
    set({ selectedCategory: cat, selectedScenarioId: "" });
    get().persist();
  },
  setSelectedScenarioId: (id) => {
    set({ selectedScenarioId: id });
    get().persist();
  },
  setSelectedPromptSet: (name) => {
    set({ selectedPromptSet: name });
    get().persist();
  },
  setTuningTarget: (target) => {
    set({ tuningTarget: target });
    get().persist();
  },
  setPromptEditingMode: (mode) => {
    set({ promptEditingMode: mode });
    get().persist();
  },
  setCustomPromptPaths: (paths) => {
    set({ customPromptPaths: paths });
    get().persist();
  },
  setMaxRounds: (n) => {
    set({ maxRounds: Math.max(1, Math.min(20, n)) });
    get().persist();
  },
  setLockedSettings: (keys) => {
    set({ lockedSettings: keys });
    get().persist();
  },
  setCustomInstructions: (text) => {
    set({ customInstructions: text });
    get().persist();
  },
  setIgnoreFormatScoring: (ignore) => {
    set({ ignoreFormatScoring: ignore });
    get().persist();
  },
  setIsNarrationEnabled: (enabled) => {
    set({ isNarrationEnabled: enabled });
    get().persist();
  },

  // Run state actions
  setIsRunning: (running) => set({ isRunning: running }),
  setPhase: (phase) => set({ phase }),
  setCurrentRound: (n) => set({ currentRound: n }),
  setAbortController: (ctrl) => set({ abortController: ctrl }),

  // Working state actions
  setWorkingSettings: (settings) => set({ workingSettings: settings }),
  setOriginalSettings: (settings) => set({ originalSettings: settings }),
  setWorkingPromptSet: (name) => set({ workingPromptSet: name }),

  // Round actions
  startNewRound: (roundNumber) => {
    const newRound: TunerRound = {
      roundNumber,
      benchmarkResult: null,
      assessmentText: "",
      proposal: null,
      proposalRaw: "",
      appliedSettings: null,
      phase: "benchmarking",
      error: undefined,
    };
    set((s) => ({
      rounds: [...s.rounds, newRound],
      currentRound: roundNumber,
      explanationStream: "",
      assessmentStream: "",
      proposalStream: "",
    }));
  },

  updateCurrentRound: (updates) =>
    set((s) => {
      const rounds = [...s.rounds];
      const idx = rounds.length - 1;
      if (idx < 0) return s;
      rounds[idx] = { ...rounds[idx], ...updates };
      return { rounds };
    }),

  setRoundBenchmarkResult: (roundIdx, result) =>
    set((s) => {
      const rounds = [...s.rounds];
      if (!rounds[roundIdx]) return s;
      rounds[roundIdx] = { ...rounds[roundIdx], benchmarkResult: result };
      return { rounds };
    }),

  setRoundAssessment: (roundIdx, text) =>
    set((s) => {
      const rounds = [...s.rounds];
      if (!rounds[roundIdx]) return s;
      rounds[roundIdx] = { ...rounds[roundIdx], assessmentText: text };
      return { rounds };
    }),

  setRoundProposal: (roundIdx, proposal, raw) =>
    set((s) => {
      const rounds = [...s.rounds];
      if (!rounds[roundIdx]) return s;
      rounds[roundIdx] = { ...rounds[roundIdx], proposal, proposalRaw: raw };
      return { rounds };
    }),

  setRoundPhase: (roundIdx, phase) =>
    set((s) => {
      const rounds = [...s.rounds];
      if (!rounds[roundIdx]) return s;
      rounds[roundIdx] = { ...rounds[roundIdx], phase };
      return { rounds };
    }),

  setRoundError: (roundIdx, error) =>
    set((s) => {
      const rounds = [...s.rounds];
      if (!rounds[roundIdx]) return s;
      rounds[roundIdx] = { ...rounds[roundIdx], error, phase: "error" };
      return { rounds };
    }),

  setRoundAppliedSettings: (roundIdx, settings) =>
    set((s) => {
      const rounds = [...s.rounds];
      if (!rounds[roundIdx]) return s;
      rounds[roundIdx] = { ...rounds[roundIdx], appliedSettings: settings };
      return { rounds };
    }),

  setRoundTurnResults: (roundIdx, turnResults) =>
    set((s) => {
      const rounds = [...s.rounds];
      if (!rounds[roundIdx]) return s;
      rounds[roundIdx] = { ...rounds[roundIdx], turnResults };
      return { rounds };
    }),

  addRoundTurnResult: (roundIdx, turnResult) =>
    set((s) => {
      const rounds = [...s.rounds];
      if (!rounds[roundIdx]) return s;
      const existing = rounds[roundIdx].turnResults || [];
      rounds[roundIdx] = { ...rounds[roundIdx], turnResults: [...existing, turnResult] };
      return { rounds };
    }),

  // Streaming actions
  appendExplanationStream: (chunk) =>
    set((s) => ({ explanationStream: s.explanationStream + chunk })),
  appendAssessmentStream: (chunk) =>
    set((s) => ({ assessmentStream: s.assessmentStream + chunk })),
  appendProposalStream: (chunk) =>
    set((s) => ({ proposalStream: s.proposalStream + chunk })),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  clearStreams: () => set({ explanationStream: "", assessmentStream: "", proposalStream: "", statusMessage: "" }),

  // Summary & post-tuning chat
  setSessionSummary: (text) => set({ sessionSummary: text }),
  appendSummaryStream: (chunk) => set((s) => ({ summaryStream: s.summaryStream + chunk })),
  addPostTuningMessage: (msg) => set((s) => ({ postTuningMessages: [...s.postTuningMessages, msg] })),
  appendPostTuningStream: (chunk) => set((s) => ({ postTuningStream: s.postTuningStream + chunk })),
  setIsPostTuningStreaming: (streaming) => set({ isPostTuningStreaming: streaming }),
  clearPostTuningStream: () => set({ postTuningStream: "" }),

  // Lifecycle
  reset: () =>
    set({
      isRunning: false,
      currentRound: 0,
      phase: "idle",
      rounds: [],
      abortController: null,
      workingSettings: null,
      originalSettings: null,
      workingPromptSet: "",
      explanationStream: "",
      assessmentStream: "",
      proposalStream: "",
      sessionSummary: "",
      summaryStream: "",
      postTuningMessages: [],
      postTuningStream: "",
      isPostTuningStreaming: false,
    }),

  persist: () => {
    if (typeof window === "undefined") return;
    const { selectedProfileId, selectedCategory, selectedScenarioId, selectedPromptSet, tuningTarget, promptEditingMode, customPromptPaths, maxRounds, lockedSettings, customInstructions, ignoreFormatScoring, isNarrationEnabled } = get();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ selectedProfileId, selectedCategory, selectedScenarioId, selectedPromptSet, tuningTarget, promptEditingMode, customPromptPaths, maxRounds, lockedSettings, customInstructions, ignoreFormatScoring, isNarrationEnabled })
      );
    } catch { /* ignore */ }
  },
}));
