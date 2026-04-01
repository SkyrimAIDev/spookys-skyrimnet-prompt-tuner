import type { TunerPhase } from "@/types/autotuner";
import type { CopycatPhase } from "@/types/copycat";

export const TUNER_PHASE_LABELS: Record<TunerPhase, string> = {
  idle: "Waiting",
  benchmarking: "Running Benchmark",
  explaining: "Self-Explanation",
  assessing: "Assessing Quality",
  proposing: "Proposing Changes",
  applying: "Applying Changes",
  complete: "Complete",
  error: "Error",
  stopped: "Stopped",
};

export const COPYCAT_PHASE_LABELS: Record<CopycatPhase, string> = {
  idle: "Waiting",
  running_reference: "Running Reference",
  running_target: "Running Target",
  comparing: "Comparing Styles",
  proposing: "Proposing Changes",
  verifying: "Verifying",
  applying: "Applying Changes",
  complete: "Complete",
  error: "Error",
  stopped: "Stopped",
};
