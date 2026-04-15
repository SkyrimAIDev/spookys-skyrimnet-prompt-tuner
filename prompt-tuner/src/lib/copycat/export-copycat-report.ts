import type { AiTuningSettings } from "@/types/config";
import type { CopycatRound } from "@/types/copycat";
import type { TuningTarget } from "@/types/autotuner";

/**
 * Pick a backtick fence longer than any backtick run inside `content`, so
 * embedded ``` blocks don't close the wrapper early.
 */
function fenceFor(content: string): string {
  const longest = (content.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

interface CopycatExportParams {
  referenceModelId: string;
  targetModelId: string;
  tuningTarget: TuningTarget;
  customInstructions: string;
  rounds: CopycatRound[];
  originalSettings: AiTuningSettings | null;
  workingSettings: AiTuningSettings | null;
}

export function buildCopycatReport(params: CopycatExportParams): string {
  const {
    referenceModelId,
    targetModelId,
    tuningTarget,
    customInstructions,
    rounds,
    originalSettings,
    workingSettings,
  } = params;

  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  // ── Header ──
  push(`# Copycat Report`);
  push("");
  push(`| | |`);
  push(`|---|---|`);
  push(`| **Date** | ${new Date().toISOString().slice(0, 10)} |`);
  push(`| **Reference Model** | \`${referenceModelId}\` |`);
  push(`| **Target Model** | \`${targetModelId}\` |`);
  push(`| **Tuning target** | ${tuningTarget} |`);
  push(`| **Rounds** | ${rounds.length} |`);

  // Effectiveness progression
  const scores = rounds
    .filter((r) => r.effectivenessScore !== null)
    .map((r) => ({ round: r.roundNumber, score: r.effectivenessScore! }));
  if (scores.length > 0) {
    push(`| **Final Score** | ${scores[scores.length - 1].score}% |`);
  }

  if (customInstructions) {
    push("");
    push(`**Custom instructions:**`);
    push("");
    push(`> ${customInstructions.replace(/\n/g, "\n> ")}`);
  }
  push("");

  // ── Effectiveness Progression ──
  if (scores.length > 1) {
    push(`## Effectiveness Progression`);
    push("");
    push(`| Round | Score |`);
    push(`|-------|-------|`);
    for (const s of scores) {
      push(`| ${s.round} | ${s.score}% |`);
    }
    push("");
  }

  // ── Settings Diff ──
  if (originalSettings && workingSettings) {
    const keys = Object.keys(originalSettings) as (keyof AiTuningSettings)[];
    const changed = keys.filter(
      (k) => JSON.stringify(originalSettings[k]) !== JSON.stringify(workingSettings[k])
    );
    if (changed.length > 0) {
      push(`## Settings Changed`);
      push("");
      push(`| Parameter | Before | After |`);
      push(`|-----------|--------|-------|`);
      for (const k of changed) {
        push(
          `| \`${k}\` | ${JSON.stringify(originalSettings[k])} | ${JSON.stringify(workingSettings[k])} |`
        );
      }
      push("");
    }
  }

  // ── Per-Round ──
  for (const round of rounds) {
    push(`---`);
    push("");
    push(`## Round ${round.roundNumber}`);
    push("");

    if (round.effectivenessScore !== null) {
      push(`**Effectiveness Score:** ${round.effectivenessScore}%`);
      push("");
    }

    // Reference Dialogue
    if (round.referenceDialogue.length > 0) {
      push(`### Reference Dialogue`);
      push("");
      for (const turn of round.referenceDialogue) {
        push(`**${turn.label}:**`);
        push("");
        const f = fenceFor(turn.response);
        push(f);
        push(turn.response);
        push(f);
        push("");
      }
    }

    // Target Dialogue
    if (round.targetDialogue.length > 0) {
      push(`### Target Dialogue`);
      push("");
      for (const turn of round.targetDialogue) {
        push(`**${turn.label}:**`);
        push("");
        const f = fenceFor(turn.response);
        push(f);
        push(turn.response);
        push(f);
        push("");
      }
    }

    // Copycat Analysis
    if (round.comparisonText) {
      push(`### Copycat Analysis`);
      push("");
      push(round.comparisonText);
      push("");
    }

    // Proposed Changes
    if (round.proposal) {
      push(`### Proposed Changes`);
      push("");

      if (round.proposal.stopTuning) {
        push(`**Tuning complete** — ${round.proposal.stopReason || "target matches reference"}`);
        push("");
      }

      if (round.proposal.reasoning) {
        push(`**Reasoning:** ${round.proposal.reasoning}`);
        push("");
      }

      if (round.proposal.settingsChanges.length > 0) {
        push(`| Parameter | Old | New | Reason |`);
        push(`|-----------|-----|-----|--------|`);
        for (const sc of round.proposal.settingsChanges) {
          push(
            `| \`${sc.parameter}\` | ${JSON.stringify(sc.oldValue)} | ${JSON.stringify(sc.newValue)} | ${sc.reason} |`
          );
        }
        push("");
      }

      if (round.proposal.promptChanges.length > 0) {
        push(`**Prompt changes:**`);
        push("");
        for (const pc of round.proposal.promptChanges) {
          push(`*${pc.filePath}* — ${pc.reason}`);
          push("");
          {
            // Full-file replacement: original on "-", new on "+"
            const original = pc.originalContent || "";
            const replacement = pc.replaceText || "";
            const diffBody =
              original.split("\n").map((l) => `- ${l}`).join("\n") +
              (original ? "\n" : "") +
              replacement.split("\n").map((l) => `+ ${l}`).join("\n");
            const f = fenceFor(diffBody);
            push(`${f}diff`);
            push(diffBody);
            push(f);
          }
          push("");
        }
      }
    }

    // Verification Runs
    if (round.verificationRuns.length > 0) {
      push(`### Verification Runs`);
      push("");
      for (const vr of round.verificationRuns) {
        push(`> "${vr.customLine}"`);
        push("");
        const f = fenceFor(vr.response);
        push(f);
        push(vr.response);
        push(f);
        push("");
      }
    }

    // Error
    if (round.error) {
      push(`### Error`);
      push("");
      push(`> ${round.error}`);
      push("");
    }
  }

  return lines.join("\n");
}
