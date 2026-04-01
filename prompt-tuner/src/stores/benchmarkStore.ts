import { create } from "zustand";
import type {
  BenchmarkCategory,
  BenchmarkResult,
  BenchmarkSubtaskResult,
  BenchmarkAssessment,
  BenchmarkScenario,
  BenchmarkDialogueTurn,
} from "@/types/benchmark";
import type { ChatMessage } from "@/types/llm";

const STORAGE_KEY = "skyrimnet-benchmark";

function loadPersisted(): {
  selectedProfileIds: string[];
  customScenarios: BenchmarkScenario[];
  activeScenarioIds: Record<string, string>;
  selectedPromptSet: string;
  quickModels: string[];
  selectedQuickModels: string[];
  isNarrationEnabled: boolean;
} {
  const defaults = { selectedProfileIds: [] as string[], customScenarios: [] as BenchmarkScenario[], activeScenarioIds: {} as Record<string, string>, selectedPromptSet: "__active__", quickModels: [] as string[], selectedQuickModels: [] as string[], isNarrationEnabled: true };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        selectedProfileIds: data.selectedProfileIds ?? [],
        customScenarios: data.customScenarios ?? [],
        activeScenarioIds: data.activeScenarioIds ?? {},
        selectedPromptSet: data.selectedPromptSet ?? "__active__",
        quickModels: data.quickModels ?? [],
        selectedQuickModels: data.selectedQuickModels ?? [],
        isNarrationEnabled: data.isNarrationEnabled ?? true,
      };
    }
  } catch { /* ignore */ }
  return defaults;
}

interface BenchmarkState {
  selectedProfileIds: string[];
  quickModels: string[];
  selectedQuickModels: string[];
  selectedPromptSet: string;
  activeCategory: BenchmarkCategory | null;
  activeScenarioIds: Record<string, string>;
  results: Record<string, BenchmarkResult>;
  assessment: BenchmarkAssessment;
  isRunning: boolean;
  activeTurns: BenchmarkDialogueTurn[] | null;
  renderedMessages: ChatMessage[] | null;
  renderedText: string;
  customScenarios: BenchmarkScenario[];
  abortController: AbortController | null;
  isNarrationEnabled: boolean;

  setActiveTurns: (turns: BenchmarkDialogueTurn[] | null) => void;
  setSelectedProfileIds: (ids: string[]) => void;
  setSelectedPromptSet: (name: string) => void;
  toggleProfileId: (id: string) => void;
  setActiveCategory: (cat: BenchmarkCategory | null) => void;
  setActiveScenarioId: (category: BenchmarkCategory, scenarioId: string) => void;
  setRendered: (messages: ChatMessage[], text: string) => void;
  setIsRunning: (running: boolean) => void;
  setAbortController: (ctrl: AbortController | null) => void;
  initResult: (key: string, result: BenchmarkResult) => void;
  updateSubtask: (key: string, subtaskIdx: number, updates: Partial<BenchmarkSubtaskResult>) => void;
  appendSubtaskStream: (key: string, subtaskIdx: number, chunk: string) => void;
  appendExplanationStream: (key: string, subtaskIdx: number, chunk: string) => void;
  updateExplanation: (key: string, subtaskIdx: number, updates: Partial<Pick<BenchmarkSubtaskResult, "explanation" | "explanationStatus" | "explanationError">>) => void;
  finalizeResult: (key: string) => void;
  clearResults: () => void;
  setAssessment: (assessment: Partial<BenchmarkAssessment>) => void;
  updateAssessmentStream: (chunk: string) => void;
  addCustomScenario: (scenario: BenchmarkScenario) => void;
  updateCustomScenario: (id: string, scenario: BenchmarkScenario) => void;
  deleteCustomScenario: (id: string) => void;
  setIsNarrationEnabled: (enabled: boolean) => void;
  addQuickModel: (model: string) => void;
  removeQuickModel: (model: string) => void;
  toggleQuickModel: (model: string) => void;
  persist: () => void;
}

const _persisted = loadPersisted();

export const useBenchmarkStore = create<BenchmarkState>((set, get) => ({
  selectedProfileIds: _persisted.selectedProfileIds,
  quickModels: _persisted.quickModels,
  selectedQuickModels: _persisted.selectedQuickModels,
  selectedPromptSet: _persisted.selectedPromptSet,
  activeCategory: null,
  activeScenarioIds: _persisted.activeScenarioIds,
  results: {},
  assessment: { streamedText: "", status: "idle" },
  isRunning: false,
  activeTurns: null,
  renderedMessages: null,
  renderedText: "",
  customScenarios: _persisted.customScenarios,
  isNarrationEnabled: _persisted.isNarrationEnabled,
  abortController: null,

  setActiveTurns: (turns) => set({ activeTurns: turns }),

  setSelectedProfileIds: (ids) => {
    set({ selectedProfileIds: ids });
    get().persist();
  },

  toggleProfileId: (id) => {
    const current = get().selectedProfileIds;
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    set({ selectedProfileIds: next });
    get().persist();
  },

  setSelectedPromptSet: (name) => {
    set({ selectedPromptSet: name });
    get().persist();
  },

  setActiveCategory: (cat) => set({ activeCategory: cat }),

  setActiveScenarioId: (category, scenarioId) => {
    set((s) => ({
      activeScenarioIds: { ...s.activeScenarioIds, [category]: scenarioId },
    }));
    get().persist();
  },

  setRendered: (messages, text) =>
    set({ renderedMessages: messages, renderedText: text }),

  setIsRunning: (running) => set({ isRunning: running }),

  setAbortController: (ctrl) => set({ abortController: ctrl }),

  initResult: (key, result) =>
    set((s) => ({ results: { ...s.results, [key]: result } })),

  updateSubtask: (key, subtaskIdx, updates) =>
    set((s) => {
      const prev = s.results[key];
      if (!prev) return s;
      const newSubtasks = [...prev.subtasks];
      newSubtasks[subtaskIdx] = { ...newSubtasks[subtaskIdx], ...updates };
      return {
        results: {
          ...s.results,
          [key]: { ...prev, subtasks: newSubtasks },
        },
      };
    }),

  appendSubtaskStream: (key, subtaskIdx, chunk) =>
    set((s) => {
      const prev = s.results[key];
      if (!prev) return s;
      const newSubtasks = [...prev.subtasks];
      newSubtasks[subtaskIdx] = {
        ...newSubtasks[subtaskIdx],
        streamedText: newSubtasks[subtaskIdx].streamedText + chunk,
      };
      return {
        results: {
          ...s.results,
          [key]: { ...prev, subtasks: newSubtasks },
        },
      };
    }),

  appendExplanationStream: (key, subtaskIdx, chunk) =>
    set((s) => {
      const prev = s.results[key];
      if (!prev) return s;
      const newSubtasks = [...prev.subtasks];
      newSubtasks[subtaskIdx] = {
        ...newSubtasks[subtaskIdx],
        explanationStreamedText: newSubtasks[subtaskIdx].explanationStreamedText + chunk,
      };
      return {
        results: {
          ...s.results,
          [key]: { ...prev, subtasks: newSubtasks },
        },
      };
    }),

  updateExplanation: (key, subtaskIdx, updates) =>
    set((s) => {
      const prev = s.results[key];
      if (!prev) return s;
      const newSubtasks = [...prev.subtasks];
      newSubtasks[subtaskIdx] = { ...newSubtasks[subtaskIdx], ...updates };
      return {
        results: {
          ...s.results,
          [key]: { ...prev, subtasks: newSubtasks },
        },
      };
    }),

  finalizeResult: (key) =>
    set((s) => {
      const prev = s.results[key];
      if (!prev) return s;
      const totalLatencyMs = prev.subtasks.reduce((sum, st) => sum + st.latencyMs, 0);
      const totalTokens = prev.subtasks.reduce((sum, st) => sum + st.totalTokens, 0);
      const hasError = prev.subtasks.some((st) => st.status === "error");
      const allDone = prev.subtasks.every((st) => st.status === "done" || st.status === "error");
      const overallStatus = hasError ? "error" : allDone ? "done" : "streaming";
      return {
        results: {
          ...s.results,
          [key]: { ...prev, totalLatencyMs, totalTokens, overallStatus },
        },
      };
    }),

  clearResults: () =>
    set({
      results: {},
      activeTurns: null,
      renderedMessages: null,
      renderedText: "",
      assessment: { streamedText: "", status: "idle" },
    }),

  setAssessment: (assessment) =>
    set((s) => ({ assessment: { ...s.assessment, ...assessment } })),

  updateAssessmentStream: (chunk) =>
    set((s) => ({
      assessment: {
        ...s.assessment,
        streamedText: s.assessment.streamedText + chunk,
      },
    })),

  addCustomScenario: (scenario) => {
    set((s) => ({ customScenarios: [...s.customScenarios, scenario] }));
    get().persist();
  },

  updateCustomScenario: (id, scenario) => {
    set((s) => ({
      customScenarios: s.customScenarios.map((sc) =>
        sc.id === id ? scenario : sc
      ),
    }));
    get().persist();
  },

  deleteCustomScenario: (id) => {
    set((s) => ({
      customScenarios: s.customScenarios.filter((sc) => sc.id !== id),
    }));
    get().persist();
  },

  setIsNarrationEnabled: (enabled) => { set({ isNarrationEnabled: enabled }); get().persist(); },

  addQuickModel: (model) => {
    const trimmed = model.trim();
    if (!trimmed) return;
    set((s) => {
      if (s.quickModels.includes(trimmed)) return s;
      return {
        quickModels: [...s.quickModels, trimmed],
        selectedQuickModels: [...s.selectedQuickModels, trimmed],
      };
    });
    get().persist();
  },
  removeQuickModel: (model) => {
    set((s) => ({
      quickModels: s.quickModels.filter((m) => m !== model),
      selectedQuickModels: s.selectedQuickModels.filter((m) => m !== model),
    }));
    get().persist();
  },
  toggleQuickModel: (model) => {
    set((s) => ({
      selectedQuickModels: s.selectedQuickModels.includes(model)
        ? s.selectedQuickModels.filter((m) => m !== model)
        : [...s.selectedQuickModels, model],
    }));
    get().persist();
  },

  persist: () => {
    if (typeof window === "undefined") return;
    const { selectedProfileIds, customScenarios, activeScenarioIds, selectedPromptSet, quickModels, selectedQuickModels, isNarrationEnabled } = get();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ selectedProfileIds, customScenarios, activeScenarioIds, selectedPromptSet, quickModels, selectedQuickModels, isNarrationEnabled })
      );
    } catch { /* ignore */ }
  },
}));
