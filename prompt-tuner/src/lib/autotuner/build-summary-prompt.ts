import type { ChatMessage } from "@/types/llm";
import type { TunerRound } from "@/types/autotuner";
import type { AiTuningSettings } from "@/types/config";

/**
 * Build messages for the session summary — called after all rounds complete.
 * The tuner LLM reviews the entire session and provides a concise wrap-up.
 */
export function buildAutoTunerSummaryMessages({
  agentName,
  rounds,
  originalSettings,
  finalSettings,
  hadPromptChanges,
  stoppedEarly,
  stopReason,
}: {
  agentName: string;
  rounds: TunerRound[];
  originalSettings: AiTuningSettings;
  finalSettings: AiTuningSettings | null;
  hadPromptChanges: boolean;
  stoppedEarly: boolean;
  stopReason?: string;
}): ChatMessage[] {
  const roundSummaries = rounds.map((r) => {
    const settingsCount = r.proposal?.settingsChanges?.length || 0;
    const promptCount = r.proposal?.promptChanges?.filter(
      (c) => !c.reason?.startsWith("[SKIPPED]")
    ).length || 0;
    const skippedCount = r.proposal?.promptChanges?.filter(
      (c) => c.reason?.startsWith("[SKIPPED]")
    ).length || 0;
    const resp = r.benchmarkResult?.response || "";
    const assessment = r.assessmentText || "";

    return `### Round ${r.roundNumber}
- Benchmark response (first 300 chars): ${resp.substring(0, 300)}${resp.length > 300 ? "..." : ""}
- Assessment summary: ${assessment.substring(0, 500)}${assessment.length > 500 ? "..." : ""}
- Changes: ${settingsCount} settings, ${promptCount} prompt edits${skippedCount > 0 ? `, ${skippedCount} skipped` : ""}
- Reasoning: ${r.proposal?.reasoning || "N/A"}${r.proposal?.stopTuning ? `\n- STOPPED: ${r.proposal.stopReason || "performing well"}` : ""}`;
  }).join("\n\n");

  // Settings diff
  const settingsDiff: string[] = [];
  if (finalSettings) {
    for (const [k, v] of Object.entries(finalSettings)) {
      const orig = originalSettings[k as keyof AiTuningSettings];
      if (JSON.stringify(v) !== JSON.stringify(orig)) {
        settingsDiff.push(`- ${k}: ${JSON.stringify(orig)} → ${JSON.stringify(v)}`);
      }
    }
  }

  const systemContent = `You are reviewing a completed tuning session for SkyrimNet's **${agentName}** agent. Provide a clear, concise summary of what happened across all rounds.

Your summary should cover:
1. **Overall outcome** — Did the tuning improve performance? How much?
2. **Key changes made** — What were the most impactful settings or prompt changes?
3. **What worked** — Which changes produced the best improvements?
4. **What didn't work** — Any changes that were reverted or had no effect?
5. **Recommendations** — Any suggestions for further improvement the user could try manually?

Keep it concise — aim for 3-5 short paragraphs. Use markdown formatting. Don't repeat the raw data — synthesize it into insights.`;

  const userContent = `## Tuning Session Results

**Agent:** ${agentName}
**Rounds completed:** ${rounds.length}
**Stopped early:** ${stoppedEarly ? `Yes — ${stopReason || "performing well"}` : "No — all rounds used"}
**Settings changed:** ${settingsDiff.length > 0 ? `\n${settingsDiff.join("\n")}` : "None"}
**Prompt changes made:** ${hadPromptChanges ? "Yes" : "No"}

## Round-by-Round Details

${roundSummaries}

Please provide a summary of this tuning session.`;

  return [
    { role: "system" as const, content: systemContent },
    { role: "user" as const, content: userContent },
  ];
}
