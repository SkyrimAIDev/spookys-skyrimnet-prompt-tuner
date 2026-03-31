import type { TunerRound } from "@/types/autotuner";
import type { AiTuningSettings } from "@/types/config";
import type { ChatMessage } from "@/types/llm";
import { applySettingsChanges, applyPromptChanges } from "./apply-changes";
import { parseProposal } from "./parse-proposal";

// ── Tool definitions for the system prompt ──────────────────────────

const TOOL_DEFINITIONS = `
## Available Tools

You have tools to inspect session data and make changes. Use XML format to call them:

<invoke name="tool_name">
<parameter name="param">value</parameter>
</invoke>

### get_round_details
Get full details for a specific round (settings changes, prompt edits, assessment, reasoning).
<invoke name="get_round_details">
<parameter name="round_number">1</parameter>
</invoke>

### get_prompt_file
Read the current content of a prompt file that was modified during the session.
<invoke name="get_prompt_file">
<parameter name="file_path">path/from/round/data</parameter>
</invoke>

### get_current_settings
Get all current inference settings.
<invoke name="get_current_settings">
</invoke>

### update_settings
Modify inference settings. Changes are applied immediately.
<invoke name="update_settings">
<parameter name="changes">[{"parameter": "temperature", "old_value": 1.4, "new_value": 1.2, "reason": "reduce randomness"}]</parameter>
</invoke>

### edit_prompt
Edit a prompt file via search/replace. The search_text must be COPIED EXACTLY from the file content (use get_prompt_file first to see the current content).
<invoke name="edit_prompt">
<parameter name="file_path">/full/path/to/file.prompt</parameter>
<parameter name="search_text">exact text to find</parameter>
<parameter name="replace_text">replacement text</parameter>
<parameter name="reason">why this change helps</parameter>
</invoke>

**Important:**
- Always use get_prompt_file before edit_prompt to see the current file content
- When answering questions, use get_round_details to retrieve specific round data rather than guessing
- If no tool is needed, just respond normally with text`;

// ── Build system prompt ─────────────────────────────────────────────

export function buildPostTuningSystemPrompt(
  sessionSummary: string,
  roundCount: number,
  modifiedFilePaths?: string[],
): string {
  const filePathSection = modifiedFilePaths && modifiedFilePaths.length > 0
    ? `## Modified Prompt Files
These files were modified during the session. Use these exact paths with get_prompt_file and edit_prompt:
${modifiedFilePaths.map((p) => `- \`${p}\``).join("\n")}`
    : "";

  return `You are the SkyrimNet tuner agent. A tuning session just completed with ${roundCount} round${roundCount !== 1 ? "s" : ""}. You can answer questions about the session and make further changes.

## Behavior
- **Be concise.** Give direct answers without narrating your thought process.
- **Use tools silently.** When you need to look up data or make edits, just call the tool and present the result. Do NOT say "Let me check..." or "Let me try..." — just do it.
- **When making edits:** Call get_prompt_file first to get exact content, then call edit_prompt with text copied exactly from the file. Do this in one smooth flow without commentary between steps.
- **Only show the user the outcome** — what changed and why, not the steps you took to get there.

## Session Summary
${sessionSummary || "No summary available."}

${filePathSection}

## Round Index
Rounds 1–${roundCount} are available. Use the get_round_details tool to inspect any specific round.

${TOOL_DEFINITIONS}`;
}

// ── Re-export shared tool parser ────────────────────────────────────

import { parseToolCalls, stripToolCallXml, type ToolCall } from "@/lib/llm/tool-parser";
export { parseToolCalls, stripToolCallXml, type ToolCall };

// ── Execute a tool call ─────────────────────────────────────────────

interface ToolRound {
  roundNumber: number;
  phase: string;
  proposal: TunerRound["proposal"];
  assessmentText?: string;
  benchmarkResult?: TunerRound["benchmarkResult"];
}

export interface ToolContext {
  rounds: ToolRound[];
  workingSettings: AiTuningSettings | null;
  setWorkingSettings: (s: AiTuningSettings) => void;
  sourceSetName?: string;
  /** For copycat: rounds have effectivenessScore and comparisonText */
  getCopycatRoundExtra?: (roundIdx: number) => string;
}

export async function executeToolCall(
  call: ToolCall,
  ctx: ToolContext,
): Promise<{ result: string; applied?: string }> {
  switch (call.name) {
    case "get_round_details": {
      const num = parseInt(call.args.round_number);
      const round = ctx.rounds.find((r) => r.roundNumber === num);
      if (!round) return { result: `Round ${num} not found. Available rounds: 1–${ctx.rounds.length}` };

      const sc = round.proposal?.settingsChanges || [];
      const pc = round.proposal?.promptChanges || [];
      const applied = pc.filter((c) => !c.reason?.startsWith("[SKIPPED]"));
      const skipped = pc.filter((c) => c.reason?.startsWith("[SKIPPED]"));

      let details = `## Round ${num}\n`;
      details += `**Phase:** ${round.phase}\n`;
      details += `**Reasoning:** ${round.proposal?.reasoning || "N/A"}\n`;
      if (round.proposal?.stopTuning) details += `**Stopped:** ${round.proposal.stopReason || "performing well"}\n`;

      if (sc.length > 0) {
        details += `\n**Settings Changes:**\n`;
        for (const c of sc) details += `- ${c.parameter}: ${JSON.stringify(c.oldValue)} → ${JSON.stringify(c.newValue)} — ${c.reason}\n`;
      }

      if (applied.length > 0) {
        details += `\n**Prompt Changes:**\n`;
        for (const c of applied) details += `- ${c.filePath.split("/").pop()}: ${c.reason}\n`;
      }

      if (skipped.length > 0) {
        details += `\n**Skipped (search text not found):**\n`;
        for (const c of skipped) details += `- ${c.filePath.split("/").pop()}\n`;
      }

      if (round.assessmentText) {
        details += `\n**Assessment:**\n${round.assessmentText.substring(0, 800)}${round.assessmentText.length > 800 ? "..." : ""}\n`;
      }

      if (round.benchmarkResult?.response) {
        details += `\n**Benchmark Response (first 500 chars):**\n${round.benchmarkResult.response.substring(0, 500)}${round.benchmarkResult.response.length > 500 ? "..." : ""}\n`;
      }

      if (ctx.getCopycatRoundExtra) {
        details += ctx.getCopycatRoundExtra(num - 1);
      }

      return { result: details };
    }

    case "get_prompt_file": {
      const path = call.args.file_path;
      // Look through rounds for the most recent version of this file
      let content: string | null = null;
      for (let i = ctx.rounds.length - 1; i >= 0; i--) {
        for (const pc of ctx.rounds[i].proposal?.promptChanges || []) {
          if (pc.filePath === path || pc.filePath.endsWith(path)) {
            content = pc.modifiedContent || pc.originalContent || null;
            if (content) break;
          }
        }
        if (content) break;
      }

      if (!content) {
        // Try to read via API
        try {
          const resp = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
          if (resp.ok) {
            const data = await resp.json();
            content = data.content;
          }
        } catch { /* skip */ }
      }

      if (!content) return { result: `File not found: ${path}` };
      return { result: `## ${path.split("/").pop()}\n\`\`\`\n${content}\n\`\`\`` };
    }

    case "get_current_settings": {
      if (!ctx.workingSettings) return { result: "No settings available." };
      const lines = Object.entries(ctx.workingSettings)
        .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
        .join("\n");
      return { result: `## Current Settings\n${lines}` };
    }

    case "update_settings": {
      if (!ctx.workingSettings) return { result: "Error: No working settings available." };
      try {
        const changes = JSON.parse(call.args.changes);
        const parsed = parseProposal(JSON.stringify({
          settings_changes: changes,
          prompt_changes: [],
          reasoning: "chat",
          stop_tuning: false,
        }));
        if (parsed.settingsChanges.length === 0) return { result: "No valid settings changes found." };
        const newSettings = applySettingsChanges(ctx.workingSettings, parsed.settingsChanges);
        ctx.setWorkingSettings(newSettings);
        const applied = parsed.settingsChanges.map(
          (c) => `${c.parameter}: ${JSON.stringify(c.oldValue)} → ${JSON.stringify(c.newValue)}`
        ).join(", ");
        return { result: `Settings updated: ${applied}`, applied: `${parsed.settingsChanges.length} setting${parsed.settingsChanges.length !== 1 ? "s" : ""} updated` };
      } catch (e) {
        return { result: `Error parsing settings changes: ${(e as Error).message}` };
      }
    }

    case "edit_prompt": {
      const { file_path, search_text, replace_text, reason } = call.args;
      if (!file_path || replace_text === undefined) return { result: "Error: file_path and replace_text are required." };
      try {
        const parsed = parseProposal(JSON.stringify({
          settings_changes: [],
          prompt_changes: [{ file_path, search_text: search_text || "", replace_text, reason: reason || "chat edit" }],
          reasoning: "chat",
          stop_tuning: false,
        }));
        const results = await applyPromptChanges(parsed.promptChanges, ctx.sourceSetName);
        const success = results.filter((c) => !c.reason?.startsWith("[SKIPPED]"));
        const skipped = results.filter((c) => c.reason?.startsWith("[SKIPPED]"));
        if (success.length > 0) {
          return { result: `Prompt edited successfully: ${file_path.split("/").pop()}`, applied: `${success.length} prompt edit${success.length !== 1 ? "s" : ""} applied` };
        } else if (skipped.length > 0) {
          return { result: `Edit skipped — search text not found in ${file_path.split("/").pop()}. Use get_prompt_file to see the current content and try again with exact text.` };
        }
        return { result: "No changes applied." };
      } catch (e) {
        return { result: `Error applying prompt edit: ${(e as Error).message}` };
      }
    }

    default:
      return { result: `Unknown tool: ${call.name}` };
  }
}

// ── Build messages for agent loop ───────────────────────────────────

/**
 * Build the full message history including tool results for the agent.
 * Tool calls and results are inserted as assistant/user message pairs.
 */
export function buildAgentMessages(
  systemPrompt: string,
  chatHistory: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...chatHistory.map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content })),
    { role: "user", content: userMessage },
  ];
}
