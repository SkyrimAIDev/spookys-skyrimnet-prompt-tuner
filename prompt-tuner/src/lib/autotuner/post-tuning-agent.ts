import type { TunerRound, PromptChange } from "@/types/autotuner";
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
The \`file_path\` must be one of the canonical relative paths shown in the
"Modified Prompt Files" section above (exact string match).
<invoke name="get_prompt_file">
<parameter name="file_path">submodules/system_head/0010_setting.prompt</parameter>
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
Replace the entire content of a prompt file with new content. This is a
**full-file replacement** — provide the complete new file in \`new_content\`,
not a partial diff. Always call \`get_prompt_file\` first to see the current
content, then output the full file with your modifications applied.

The \`file_path\` must be one of the canonical relative paths from the
"Modified Prompt Files" section — exact string match. No absolute paths.

<invoke name="edit_prompt">
<parameter name="file_path">submodules/system_head/0010_setting.prompt</parameter>
<parameter name="new_content">THE COMPLETE NEW FILE CONTENT WITH YOUR CHANGES APPLIED</parameter>
<parameter name="reason">why this change helps</parameter>
</invoke>

**Important:**
- Always use get_prompt_file before edit_prompt to read the current file content
- Output the FULL file in new_content — preserving all template syntax (\`{{ }}\`, \`{% %}\`) and section markers exactly as they appear
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
- **When making edits:** Call get_prompt_file first to get the current content, then call edit_prompt with the COMPLETE new file in \`new_content\`. Do this in one smooth flow without commentary between steps.
- **Only show the user the outcome** — what changed and why, not the steps you took to get there.

## Path discipline
Both \`get_prompt_file\` and \`edit_prompt\` require an exact canonical relative path (e.g. \`submodules/system_head/0010_setting.prompt\`) — the same paths the autotuner used during the session. They are listed in the "Modified Prompt Files" section below. Do NOT shorten, abbreviate, or invent paths. Validation rejects anything that is not a byte-for-byte match.

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
  /**
   * Whitelist of canonical relative paths the chat agent is allowed to read
   * or edit — same paths the autotuner used during the session. Built from
   * the modified files of all rounds in the completed session.
   */
  modifiedFiles?: string[];
  /** For copycat: rounds have effectivenessScore and comparisonText */
  getCopycatRoundExtra?: (roundIdx: number) => string;
}

export interface AppliedChange {
  type: "settings" | "prompt";
  summary: string;
  settingsChanges?: { parameter: string; oldValue: unknown; newValue: unknown; reason: string }[];
  promptChanges?: { filePath: string; searchText: string; replaceText: string; reason: string }[];
}

export async function executeToolCall(
  call: ToolCall,
  ctx: ToolContext,
): Promise<{ result: string; applied?: AppliedChange }> {
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
      if (!path) return { result: "Error: file_path is required." };

      // Strict whitelist match — agent must use the exact relative path.
      if (ctx.modifiedFiles && ctx.modifiedFiles.length > 0 && !ctx.modifiedFiles.includes(path)) {
        return {
          result: `Error: "${path}" is not in the modified files list. Use one of:\n${ctx.modifiedFiles.map((p) => `- ${p}`).join("\n")}`,
        };
      }

      // Read from temp set → source set → originals via the set-aware endpoint.
      const fallbackSets: string[] = [];
      if (ctx.sourceSetName && ctx.sourceSetName !== "__tuner_temp__") fallbackSets.push(ctx.sourceSetName);
      fallbackSets.push("__original__");
      try {
        const resp = await fetch("/api/files/read-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relativePath: path, promptSet: "__tuner_temp__", fallbackSets }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.content) {
            return { result: `## ${path}\n\`\`\`\n${data.content}\n\`\`\`` };
          }
        }
      } catch { /* fall through */ }

      return { result: `File not found: ${path}` };
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
        return {
          result: `Settings updated: ${parsed.settingsChanges.map((c) => `${c.parameter}: ${JSON.stringify(c.oldValue)} → ${JSON.stringify(c.newValue)}`).join(", ")}`,
          applied: {
            type: "settings",
            summary: `${parsed.settingsChanges.length} setting${parsed.settingsChanges.length !== 1 ? "s" : ""} updated`,
            settingsChanges: parsed.settingsChanges.map((c) => ({
              parameter: String(c.parameter),
              oldValue: c.oldValue,
              newValue: c.newValue,
              reason: c.reason,
            })),
          },
        };
      } catch (e) {
        return { result: `Error parsing settings changes: ${(e as Error).message}` };
      }
    }

    case "edit_prompt": {
      const { file_path, new_content, reason } = call.args;
      if (!file_path || new_content === undefined) {
        return { result: "Error: file_path and new_content are required." };
      }

      // Strict whitelist match against the session's modified files.
      if (ctx.modifiedFiles && ctx.modifiedFiles.length > 0 && !ctx.modifiedFiles.includes(file_path)) {
        return {
          result: `Error: "${file_path}" is not in the modified files list. Use one of:\n${ctx.modifiedFiles.map((p) => `- ${p}`).join("\n")}`,
        };
      }

      try {
        const change: PromptChange = {
          filePath: file_path,
          searchText: "",
          replaceText: new_content,
          originalContent: "",
          modifiedContent: "",
          reason: reason || "chat edit",
        };
        const results = await applyPromptChanges([change], ctx.sourceSetName);
        const success = results.filter((c) => !c.reason?.startsWith("[SKIPPED]"));
        const skipped = results.filter((c) => c.reason?.startsWith("[SKIPPED]"));
        if (success.length > 0) {
          return {
            result: `Prompt edited successfully: ${file_path}`,
            applied: {
              type: "prompt",
              summary: `${success.length} prompt edit${success.length !== 1 ? "s" : ""} applied`,
              promptChanges: success.map((c) => ({
                filePath: c.filePath,
                searchText: "",
                replaceText: c.replaceText || "",
                reason: c.reason || "",
              })),
            },
          };
        } else if (skipped.length > 0) {
          return { result: `Edit skipped: ${skipped[0].reason}` };
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
