import type { ChatMessage } from "@/types/llm";
import type { AiTuningSettings } from "@/types/config";
import type { TuningTarget, TunerRound } from "@/types/autotuner";
import type { BenchmarkCategory } from "@/types/benchmark";
import { getCategoryDef } from "@/lib/benchmark/categories";
import { AGENT_DESCRIPTIONS } from "@/types/config";
import { RECOMMENDED_PROMPTS, PROMPT_EDITING_GUIDES, NEW_PROMPT_LOCATIONS } from "./prompt-editing-modes";

/**
 * Build an agent-specific pipeline architecture guide that explains
 * which files control what aspects and where the tuner should make edits.
 */
export function buildPipelineGuide(agent: string): string {
  switch (agent) {
    case "default":
      return `This agent uses the **dialogue response** pipeline. The final prompt is assembled from multiple numbered files. Each file is tagged **[EDITABLE]**, **[EDIT WITH CARE]**, or **[DO NOT EDIT]** in the file listings below.

### IMPORTANT: Read Before You Edit
Before proposing any change to a file, carefully study its FULL content shown below. Understand:
- What instructions already exist (don't duplicate them)
- The file's structure and any Inja template blocks (\`{% if %}\`, \`{{ }}\`)
- Where plain-text instructions sit BETWEEN template blocks (that's where your edits go)
- Whether the change you want is already partially covered (modify the existing instruction instead of adding a new one)

### Preferred Approach: Create New Files Over Modifying Existing Ones
SkyrimNet's extension model is **composition via numbered submodule files**. When possible, create a new file in the right submodule directory rather than modifying existing files. This preserves the original author's tested instructions and makes changes easier to track and revert. Only modify existing files when you need to change or remove a SPECIFIC existing instruction.

### Pipeline Assembly Order

**System message:**
1. \`dialogue_response.prompt\` — Entry-point scaffold. Sets identity line, calls render_subcomponent. DO NOT EDIT.
2. \`submodules/system_head/\` — Loaded in numerical order:
   - \`0010_instructions.prompt\` — Task description per render_mode. EDIT WITH CARE (has branching).
   - \`0010_setting.prompt\` — **World setting (nearly empty by default).** EDITABLE. Best place for universal world-building or tone.
   - *(slot 0015)* — **Available for new file.** Good for universal behavioral modifiers.
   - \`0020_format_rules.prompt\` — Loads guidelines + length constraints. EDIT WITH CARE. Only edit the length numbers.
   - \`0100_actor_bios.prompt\` through \`0400_speech_style_bio.prompt\` — Pure template scaffolding. DO NOT EDIT.
3. \`submodules/guidelines/\` — Core behavioral rules (loaded by 0020_format_rules via render_subcomponent):
   - \`0500_roleplay_guidelines.prompt\` — **Roleplay behavior.** EDITABLE. How to embody the character, use personality, react authentically.
   - *(slots 0600-0800)* — **Available for new files.** Ideal for: writing quality rules, prose craft, emotional depth, conversational naturalism.
   - \`0900_response_format.prompt\` — **Response format.** EDITABLE. Narration rules, asterisks, length within dialogue, thoughts format. Has conditional branches — edit the prose within branches, don't restructure.

**Conversation history:**
4. \`components/event_history.prompt\` — Template-heavy formatter. DO NOT EDIT.

**Final user message:**
5. \`submodules/user_final_instructions/\` — Loaded in numerical order. Last thing the LLM sees before generating:
   - \`0150_environmental_awareness.prompt\` — EDIT WITH CARE
   - \`0200_combat_status.prompt\` — DO NOT EDIT (stat injection)
   - *(slots 0300-0600)* — **Available for new files.** High-impact position for final-turn reminders, quality checks, anti-patterns.
   - \`0650_audio_tags.prompt\` — DO NOT EDIT (complex TTS logic)
   - \`0700_extra_instructions.prompt\` — EDIT WITH CARE
   - \`0750_embedded_actions.prompt\` — EDIT WITH CARE
   - \`0800_direct_narration.prompt\`, \`8000_recent_state_changes.prompt\` — DO NOT EDIT

### Decision Guide
| Goal | Best approach |
|------|--------------|
| Improve roleplay depth / character authenticity | Edit \`guidelines/0500_roleplay_guidelines.prompt\` — append or modify existing instructions |
| Add writing quality / prose craft rules | **Create \`guidelines/0650_writing_quality.prompt\`** (new file) |
| Change response length limits | Edit length numbers in \`system_head/0020_format_rules.prompt\` |
| Change narration frequency / format | Edit \`guidelines/0900_response_format.prompt\` — find the specific rule and modify it |
| Add world-building / tone / atmosphere | Edit \`system_head/0010_setting.prompt\` (mostly empty, add content) |
| Add new behavioral rules | **Create \`guidelines/0600_custom.prompt\`** or similar numbered file |
| Add final-turn reminders / quality checks | **Create \`user_final_instructions/0400_custom.prompt\`** (new file) |
| Change task framing (rare) | Edit prose in \`system_head/0010_instructions.prompt\` carefully around template blocks |`;

    case "meta_eval":
      return `This agent uses **standalone target/speaker selector** prompts — NO system_head or guidelines.

Read the full file content below before proposing changes. These files mix template logic with selection criteria — only edit the plain-text criteria and reasoning instructions, not the template blocks.

### Files
- **\`target_selectors/\`** — EDIT WITH CARE. Selection criteria (proximity, authority, personal stakes, etc.) are the editable portions.
- **\`components/event_history_compact.prompt\`** — DO NOT EDIT (template formatter).`;

    case "action_eval":
      return `This agent uses the **native action selector** — standalone, NO system_head or guidelines.

Read the full file content below before proposing changes. The file has conditional JSON vs text output format — preserve both branches.

### Files
- **\`native_action_selector.prompt\`** — EDIT WITH CARE. The selection criteria and guidelines text are editable. Preserve template conditionals and both format branches.
- **\`components/event_history_compact.prompt\`** — DO NOT EDIT (template formatter).`;

    case "game_master":
      return `This agent uses **Game Master** prompts — standalone, NO system_head or guidelines.

Read the full file content below before proposing changes. Both files have conditional branches for continuous mode and scene plans — edit the prose, not the branching structure.

### Files
- **\`gamemaster_action_selector.prompt\`** — EDIT WITH CARE. The Style section and action descriptions are the main editable portions. Has complex conditional branches for continuous mode — preserve these.
- **\`gamemaster_scene_planner.prompt\`** — EDITABLE. Mostly plain text. Beat types, planning guidelines, and player independence rules are all editable. Preserve the JSON output format.
- **\`components/event_history_compact.prompt\`** — DO NOT EDIT (template formatter).`;

    case "memory_gen":
      return `This agent uses the **memory generation** pipeline — only the setting file, NOT full system_head.

Read the full file content below before proposing changes. The memory prompt has specific JSON format requirements that MUST be preserved.

### Files
- **\`submodules/system_head/0010_setting.prompt\`** — EDITABLE. World setting (shared across agents). Keep additions concise.
- **\`memory/generate_memory.prompt\`** — EDITABLE. Content guidelines, style examples, importance scoring are all editable prose. The "Be CONCISE but SPECIFIC" philosophy is key. Preserve JSON output format.
- **\`components/event_history_verbose.prompt\`** — DO NOT EDIT (template formatter).`;

    case "diary":
      return `This agent uses the **diary entry** pipeline — full system_head + guidelines (like dialogue), plus the diary template.

Read the full file content below before proposing changes. The diary prompt has 10 numbered writing guidelines — understand what's already there before adding or modifying.

### Files
- **\`submodules/system_head/\`** and **\`submodules/guidelines/\`** — Same as dialogue pipeline (see dialogue guide for details).
- **\`diary_entry.prompt\`** — EDITABLE. The 10 numbered guidelines control diary quality: emotional depth, scene expansion, transitions, physical grounding. Length target (\`targetEntryLength\`) is a template variable. Preserve JSON output format.
- **\`components/event_history_verbose.prompt\`** — DO NOT EDIT (template formatter).

### Decision Guide
| Goal | Best approach |
|------|--------------|
| Change diary writing style | Edit the numbered guidelines in \`diary_entry.prompt\` |
| Change roleplay depth (affects dialogue too) | Edit \`guidelines/0500_roleplay_guidelines.prompt\` |
| Change world setting (affects all agents) | Edit \`system_head/0010_setting.prompt\` |`;

    case "profile_gen":
      return `This agent uses the **bio update** pipeline — only the setting file, NOT full system_head.

Read the full file content below before proposing changes. This prompt has extensive block definitions and a conservative update philosophy — understand the existing rules before modifying.

### Files
- **\`submodules/system_head/0010_setting.prompt\`** — EDITABLE. World setting (shared across agents).
- **\`dynamic_bio_update.prompt\`** — EDITABLE. The conservative update philosophy ("95% should be MINIMAL or NO CHANGE") is the core tuning target. Block definitions, target lengths, and pruning strategies are editable. Preserve JSON output format and block name references.
- **\`components/event_history_verbose.prompt\`** — DO NOT EDIT (template formatter).`;

    default:
      return `Review the prompt files below. Each file serves a specific role in the pipeline. Choose the most appropriate file for your edit based on what aspect of behavior you want to change.`;
  }
}

const SETTINGS_DESCRIPTIONS: Record<keyof AiTuningSettings, string> = {
  temperature: "Controls randomness. Lower = more deterministic, higher = more creative. Range: 0.0-2.0",
  maxTokens: "Maximum tokens in the response. Higher allows longer outputs.",
  topP: "Nucleus sampling. Lower values focus on more likely tokens. Range: 0.0-1.0",
  topK: "Top-K sampling. Number of top tokens to consider. 0 = disabled.",
  frequencyPenalty: "Penalizes repeated tokens based on frequency. Range: -2.0 to 2.0",
  presencePenalty: "Penalizes tokens that have appeared at all. Range: -2.0 to 2.0",
  stopSequences: "JSON array of strings that stop generation when encountered.",
  structuredOutputs: "Whether to use structured/JSON output mode.",
  allowReasoning: "Whether to allow the model to use extended thinking/reasoning. In SkyrimNet, reasoning OFF usually produces better and faster roleplay results. Only enable if the task genuinely requires complex multi-step analysis.",
  reasoningEffort: "Controls how much reasoning budget to allocate when allowReasoning is enabled. Values: 'none', 'minimal' (~10%), 'low' (~20%), 'medium' (~50%), 'high' (~80%), 'xhigh' (~95%). Lower effort = faster responses, higher effort = deeper analysis. Only relevant when allowReasoning is true.",
};

/**
 * Build prompt editing rules based on the selected editing mode.
 * Returns the rules section (numbered from 8 onward) to insert into the system prompt.
 */
export function buildPromptEditingRules(category: BenchmarkCategory, mode: import("@/types/autotuner").PromptEditingMode): string {
  const recommended = RECOMMENDED_PROMPTS[category] || [];
  const newLocation = NEW_PROMPT_LOCATIONS[category];

  // Common rules for all modes
  const commonRules = `9. **When modifying files, output the COMPLETE new file content.** Set \`search_text\` to \`""\` and put the entire modified file in \`replace_text\`. Preserve ALL template syntax (\`{{ }}\`, \`{% %}\`, section markers, decorator calls) exactly as they appear — only change the plain-text instruction content.
10. **Prompt changes must be universal.** These prompts are used for THOUSANDS of different NPC dialogues across all of Skyrim — guards, merchants, innkeepers, quest characters, companions, etc. Proposed changes must improve quality for ANY NPC in ANY context. NEVER propose changes specific to the current benchmark scenario.
11. **Keep additions concise.** SkyrimNet has a default max context of 4096 tokens. The official docs warn: "Too many rules = more hallucinations." Add the minimum instruction needed. A single clear sentence beats a paragraph of explanation.`;

  // Build per-file editing guides for recommended prompts
  const editingGuides = recommended
    .map((p) => {
      const filename = p.split("/").pop() || p;
      const guide = PROMPT_EDITING_GUIDES[filename];
      return guide ? `#### \`${filename}\`\n${guide}` : null;
    })
    .filter(Boolean)
    .join("\n\n");

  if (mode === "world_settings") {
    const settingGuide = PROMPT_EDITING_GUIDES["0010_setting.prompt"] || "";
    return `8. **ONLY edit the world setting prompt.** You may ONLY propose changes to \`0010_setting.prompt\` (the world setting file in \`submodules/system_head/\`). Do NOT create new files. Do NOT edit any other files under any circumstance.
   This file defines the global world rules, tone, and atmosphere that shape how ALL NPCs behave. Add or modify setting descriptions that will improve dialogue quality across the entire world.

${commonRules}

## World Setting Editing Guide

${settingGuide ? `#### \`0010_setting.prompt\`\n${settingGuide}` : "The world setting prompt is the primary user customization point. Add prose content after the header to define world rules, tone, and atmosphere."}`;
  }

  if (mode === "recommended") {
    return `8. **ONLY edit the recommended prompts for this agent.** You may ONLY propose changes to these specific files:
${recommended.map((p) => `   - \`${p.split("/").pop()}\``).join("\n")}
   Do NOT create new files. Do NOT edit other files. Focus your edits on these files because they have the highest impact on this agent's output quality.

${commonRules}

## Recommended Prompt Editing Guide

Each recommended prompt has specific safe-to-edit areas and template logic that must not be touched:

${editingGuides}`;
  }

  if (mode === "new_prompt") {
    return `8. **Create a NEW prompt file — do NOT edit existing files.** You must create one new submodule file instead of modifying any existing prompt.
   - Directory: \`${newLocation?.directory || "."}\`
   - ${newLocation?.numberingHint || "Use a 4-digit numeric prefix for file ordering."}
   - To create a new file: use an empty \`search_text\` ("") and provide the full file content in \`replace_text\`
   - Your new file should contain ONLY plain-text instructions — do NOT use template syntax unless you fully understand the Inja engine
   - Do NOT duplicate instructions that already exist in the files shown below

${commonRules}`;
  }

  if (mode === "custom") {
    return `8. **ONLY edit the user-selected prompt files.** The user has chosen specific files they want you to modify. You may ONLY propose changes to those files. Do NOT create new files. Do NOT edit any other files under any circumstance.

${commonRules}`;
  }

  // "auto" mode — enhanced with recommended prompt awareness
  return `8. **Choose between editing an existing file or creating a new one.** First, read all existing files in the relevant submodule to check if your intended instructions are already covered or closely related to existing content. Then:
   - **Edit an existing file** if your change naturally fits alongside its current instructions (e.g., adding a roleplay rule to the roleplay guidelines file, or tweaking an existing instruction). This avoids scattering related rules across multiple files.
   - **Create a new file** when your instructions represent a genuinely new topic not covered by any existing file. Use a numbered name that places it in the right position within the submodule directory.
   - **Recommended high-impact files for this agent:**
${recommended.map((p) => `     - \`${p.split("/").pop()}\``).join("\n")}
   - To create a new file: use an empty \`search_text\` ("") and put the full file content in \`replace_text\`
   - NEVER duplicate instructions that already exist in another file

${commonRules}

## Recommended Prompt Editing Guide

These are the highest-impact prompts for this agent. Prefer editing these over other files:

${editingGuides}`;
}

/**
 * Build messages for the proposal step of auto-tuning.
 * The tuner LLM receives context about the agent, current settings/prompts,
 * previous rounds, and the latest benchmark + assessment, then proposes changes.
 */
export function buildProposalMessages({
  category,
  tuningTarget,
  currentSettings,
  originalSettings,
  promptContent,
  previousRounds,
  currentAssessment,
  currentResponse,
  currentLatencyMs,
  currentTokens,
  lockedSettings = [],
  customInstructions = "",
  ignoreFormatScoring = false,
  promptEditingMode = "auto",
}: {
  category: BenchmarkCategory;
  tuningTarget: TuningTarget;
  currentSettings: AiTuningSettings;
  originalSettings: AiTuningSettings;
  promptContent: string;
  previousRounds: TunerRound[];
  currentAssessment: string;
  currentResponse: string;
  currentLatencyMs: number;
  currentTokens: number;
  lockedSettings?: (keyof AiTuningSettings)[];
  customInstructions?: string;
  ignoreFormatScoring?: boolean;
  promptEditingMode?: import("@/types/autotuner").PromptEditingMode;
}): ChatMessage[] {
  const catDef = getCategoryDef(category);
  const agentName = catDef?.label || category;
  const agentDesc = catDef ? AGENT_DESCRIPTIONS[catDef.agent] : "";

  // What the tuner can modify
  const canModifySettings = tuningTarget === "settings" || tuningTarget === "both";
  const canModifyPrompts = tuningTarget === "prompts" || tuningTarget === "both";

  // Build settings section
  const settingsSection = canModifySettings
    ? `## Current Inference Settings

${Object.entries(currentSettings)
  .map(([key, value]) => {
    const desc = SETTINGS_DESCRIPTIONS[key as keyof AiTuningSettings] || "";
    const origVal = originalSettings[key as keyof AiTuningSettings];
    const changed = JSON.stringify(value) !== JSON.stringify(origVal);
    const isLocked = lockedSettings.includes(key as keyof AiTuningSettings);
    return `- **${key}**: \`${JSON.stringify(value)}\` ${changed ? `(originally: \`${JSON.stringify(origVal)}\`)` : ""}${isLocked ? " **(LOCKED — do not change)**" : ""} — ${desc}`;
  })
  .join("\n")}

You may propose changes to any UNLOCKED settings. Use the parameter name exactly as shown.${lockedSettings.length > 0 ? ` Do NOT propose changes to locked settings: ${lockedSettings.join(", ")}.` : ""}`
    : "";

  // Build prompts section with pipeline architecture guide
  let promptsSection = "";
  if (canModifyPrompts) {
    if (promptContent) {
      // Build agent-specific pipeline guide
      const pipelineGuide = buildPipelineGuide(catDef?.agent || "default");
      promptsSection = `## Prompt Pipeline Architecture

${pipelineGuide}

## Current Prompt Files

The following prompt files are used by this agent. To modify a file, set \`search_text\` to \`""\` (empty) and put the COMPLETE new file content in \`replace_text\`. This replaces the entire file — output ALL of it with your modifications applied.
**IMPORTANT:** The file_path in each section header is the exact path you must use in your prompt_changes proposals. Copy it exactly. Preserve ALL template syntax (\`{{ }}\`, \`{% %}\`) — only modify plain-text instructions.

${promptContent}`;
    } else {
      promptsSection = `## Prompt Files

No prompt files could be loaded for this prompt set. You cannot propose prompt changes this round.`;
    }
  }

  // Previous rounds summary — include assessment so the tuner can see what improved/regressed
  // Also build a concise "tried settings" ledger so the tuner can see at a glance what was tested
  const triedSettings = new Map<string, Set<string>>();
  // Start with original settings as baseline
  for (const [k, v] of Object.entries(originalSettings)) {
    if (!triedSettings.has(k)) triedSettings.set(k, new Set());
    triedSettings.get(k)!.add(JSON.stringify(v));
  }
  for (const r of previousRounds) {
    if (r.appliedSettings) {
      for (const [k, v] of Object.entries(r.appliedSettings)) {
        if (!triedSettings.has(k)) triedSettings.set(k, new Set());
        triedSettings.get(k)!.add(JSON.stringify(v));
      }
    }
  }
  // Also add current settings
  for (const [k, v] of Object.entries(currentSettings)) {
    if (!triedSettings.has(k)) triedSettings.set(k, new Set());
    triedSettings.get(k)!.add(JSON.stringify(v));
  }

  const triedSettingsLedger = [...triedSettings.entries()]
    .filter(([, vals]) => vals.size > 1)
    .map(([k, vals]) => `- ${k}: tried ${[...vals].join(", ")}`)
    .join("\n");

  const previousRoundsSection = previousRounds.length > 0
    ? `## Previous Rounds

**IMPORTANT:** Review this history carefully. Do NOT propose setting values that were already tested in a previous round and produced poor results. Each round must try something genuinely new.

${triedSettingsLedger ? `### Settings Already Tried\n${triedSettingsLedger}\n` : ""}
${previousRounds.map((r, idx) => {
  // For deep sessions (>5 rounds), summarize middle rounds to save context
  const isDetailed = previousRounds.length <= 5 || idx < 2 || idx >= previousRounds.length - 2;

  if (!isDetailed) {
    const sc = r.proposal?.settingsChanges?.length || 0;
    const pc = r.proposal?.promptChanges?.length || 0;
    return `### Round ${r.roundNumber} (summary)\n- ${sc} settings, ${pc} prompt changes | ${r.proposal?.reasoning?.substring(0, 100) || "N/A"}`;
  }

  const resp = r.benchmarkResult?.response || "";
  const settingsChanges = r.proposal?.settingsChanges?.length
    ? `Settings changes: ${r.proposal.settingsChanges.map((c) => `${c.parameter}: ${JSON.stringify(c.oldValue)} → ${JSON.stringify(c.newValue)}`).join(", ")}`
    : "No settings changes";
  const promptChanges = r.proposal?.promptChanges?.length
    ? `Prompt changes: ${r.proposal.promptChanges.map((c) => {
        const fileName = c.filePath.split("/").pop() || c.filePath;
        return `\`${fileName}\`: ${c.reason}`;
      }).join("; ")}`
    : "No prompt changes";
  const assessmentSummary = r.assessmentText
    ? `Assessment:\n${r.assessmentText.substring(0, 800)}${r.assessmentText.length > 800 ? "..." : ""}`
    : "Assessment: N/A";
  return `### Round ${r.roundNumber}
- Response: ${resp.substring(0, 400)}${resp.length > 400 ? "..." : ""}
- Latency: ${r.benchmarkResult?.latencyMs || 0}ms | Tokens: ${r.benchmarkResult?.totalTokens || 0}
- ${settingsChanges}
- ${promptChanges}
- Reasoning: ${r.proposal?.reasoning || "N/A"}
- ${assessmentSummary}`;
}).join("\n\n")}`
    : "";

  // Allowed modifications section
  const allowedMods: string[] = [];
  if (canModifySettings) allowedMods.push("inference settings (temperature, topP, topK, maxTokens, penalties, etc.)");
  if (canModifyPrompts) allowedMods.push("prompt file content");

  const systemContent = `You are an expert AI tuner for SkyrimNet, an AI-powered NPC system for Skyrim.

## Your Task

You are tuning the **${agentName}** agent (${agentDesc}).

Your job is to analyze benchmark results and assessments, then propose specific changes to improve the agent's performance. You may modify: ${allowedMods.join(" and ")}.

## Guidelines

1. **Make incremental changes.** Don't change everything at once. Focus on the most impactful improvement.
2. **Consider trade-offs.** Changing temperature affects both creativity and consistency. Changing max tokens affects both completeness and cost.
3. **Stop when performing well.** If the response quality is good and the assessment is positive, set stop_tuning to true.
4. **NEVER repeat a failed approach.** Before proposing any change, check the previous rounds. If a setting value was already tried and produced poor results, do NOT set it back to that value. Each round must try something meaningfully new — not a combination that is logically equivalent to a prior failure.
5. **Be specific in reasoning.** Explain why each change should help and how it differs from what was already tried.
6. **Know your limits.** If the assessment identifies issues that CANNOT be fixed with your available tuning levers (e.g. the prompt needs format changes but you can only tune settings), set stop_tuning to true and explain what changes are needed in stop_reason. Do not waste rounds re-testing settings when the problem is clearly in the prompt.
${canModifyPrompts ? `7. **Read and understand BEFORE editing.** The full content of each file is shown below with editability tags. Before proposing ANY change:
   - Read the file's FULL content to understand what instructions already exist
   - Identify where plain-text instructions sit between template blocks (\`{% %}\`, \`{{ }}\`) — ONLY edit the plain text
   - Check if an existing instruction already partially covers your intent (modify it rather than adding a duplicate)
   - Respect the file's structure: if it has numbered sections, conditional branches, or a specific format, maintain that structure
   - NEVER edit files tagged **[DO NOT EDIT]** — they are pure template scaffolding shown only as context
   - For files tagged **[EDIT WITH CARE]** — only modify plain-text prose, never restructure template blocks
${buildPromptEditingRules(category, promptEditingMode)}
## SkyrimNet Template Syntax (Inja)

Prompt files use the Inja template engine (similar to Jinja2 but NOT identical). Key syntax rules:
- Variables: \`{{ variable_name }}\`, e.g. \`{{ decnpc(npc.UUID).name }}\`
- Conditionals: \`{% if condition %}\`, \`{% else if condition %}\`, \`{% else %}\`, \`{% endif %}\` — NOTE: use \`else if\`, NOT \`elif\`
- Loops: \`{% for item in list %}\`...\`{% endfor %}\`
- Section markers: \`[ system ]\`, \`[ user ]\`, \`[ assistant ]\`, \`[ cache ]\` — these separate prompt sections
- Common decorators: \`render_subcomponent(name, mode)\`, \`render_template(path)\`, \`render_character_profile(mode, UUID)\`, \`decnpc(UUID).name\`, \`is_in_combat(UUID)\`, \`is_narration_enabled()\`
- The \`render_mode\` variable controls which variant of submodules to render (e.g. "full", "transform", "thoughts")
- Some files (especially in \`submodules/\`) are assembled by the engine into larger prompts — a file like \`0020_format_rules.prompt\` may call \`render_subcomponent("guidelines", render_mode)\` to include files from \`submodules/guidelines/\`

**IMPORTANT:** When proposing prompt changes, only modify plain-text instruction content. Do NOT modify template syntax (\`{{ }}\`, \`{% %}\`), section markers, or decorator calls unless you fully understand the Inja engine. Adding or editing natural-language instructions between template blocks is safe.` : ""}
${canModifyPrompts ? "12" : "7"}. **Avoid enabling reasoning.** For SkyrimNet roleplay agents, \`allowReasoning: false\` produces better results 9 times out of 10. Reasoning adds latency and token cost without improving dialogue quality. Only enable it if the task requires complex multi-step logical analysis (not creative text generation).
${canModifyPrompts ? "13" : "8"}. **Ignore self-explanation quality.** The model's self-explanation is generated in a separate diagnostic call with its own token budget. Changing inference settings (especially maxTokens) will NOT affect explanation verbosity. Focus only on the actual benchmark response quality.${ignoreFormatScoring ? `
${canModifyPrompts ? "14" : "9"}. **IGNORE FORMAT.** The user has opted to skip format scoring. Do NOT propose changes aimed at fixing format, JSON structure, metadata fields, importance scores, emotion fields, or any output format aspects. The output format is dictated by SkyrimNet's engine requirements and is correct as-is. Focus exclusively on content quality, accuracy, and efficiency.` : ""}
${customInstructions.trim() ? `
## User Instructions (PRIORITY — follow these above all other guidelines)

${customInstructions.trim()}
` : ""}
## Response Format

Respond with a JSON object (no markdown fences):

{
  "stop_tuning": false,
  "stop_reason": "optional reason if stopping",
  "reasoning": "explain your analysis and why these changes should help",
  "settings_changes": [
    { "parameter": "temperature", "old_value": 0.7, "new_value": 0.5, "reason": "reduce randomness for more consistent responses" }
  ]${canModifyPrompts ? `,
  "prompt_changes": [
    { "file_path": "/absolute/path/to/file.prompt", "search_text": "", "replace_text": "THE COMPLETE NEW FILE CONTENT — output the entire file with your changes applied", "reason": "why this change helps" }
  ]` : ""}
}

**IMPORTANT for prompt_changes:** Always set \`search_text\` to \`""\` (empty string) and put the COMPLETE new file content in \`replace_text\`. This replaces the entire file. Do NOT try to do partial search/replace — output the full file with your modifications applied. Preserve all template syntax (\`{{ }}\`, \`{% %}\`), section markers, and decorator calls exactly as they appear in the original file. Only modify the plain-text instruction content.

If no changes are needed for a category, use an empty array. Always include all fields.${!canModifyPrompts ? " Do NOT include prompt_changes — you are only tuning inference settings." : ""}`;

  const userContent = `## This Round's Benchmark Result

**Response:**
\`\`\`
${currentResponse.substring(0, 3000)}${currentResponse.length > 3000 ? "\n... (truncated)" : ""}
\`\`\`

**Performance:** ${currentLatencyMs}ms latency | ${currentTokens} total tokens

## Quality Assessment

${currentAssessment}

${settingsSection}

${promptsSection}

${previousRoundsSection}

Based on the assessment above, propose changes to improve the ${agentName} agent's performance. If performance is already good, set stop_tuning to true.`;

  return [
    { role: "system" as const, content: systemContent },
    { role: "user" as const, content: userContent },
  ];
}
