import type { ChatMessage } from "@/types/llm";
import type { AiTuningSettings } from "@/types/config";
import type { TuningTarget, TunerRound } from "@/types/autotuner";
import type { BenchmarkCategory } from "@/types/benchmark";
import { getCategoryDef } from "@/lib/benchmark/categories";
import { AGENT_DESCRIPTIONS } from "@/types/config";

/**
 * Build an agent-specific pipeline architecture guide that explains
 * which files control what aspects and where the tuner should make edits.
 */
export function buildPipelineGuide(agent: string): string {
  switch (agent) {
    case "default":
      return `This agent uses the **dialogue response** pipeline. The final prompt sent to the LLM is assembled from multiple files loaded in a specific order. Understanding this pipeline is critical for choosing WHERE to edit.

### Assembly Order (system message)
1. **\`dialogue_response.prompt\`** — Entry-point template. Sets the character identity line ("You are {name}, a {gender} {race}...") and calls \`render_subcomponent("system_head")\`. This file is mostly **structural scaffolding** — editing it changes template structure, NOT behavioral instructions. You should rarely need to edit this file.
2. **\`submodules/system_head/\`** — Loaded in numerical order within the system message:
   - \`0010_instructions.prompt\` — Task description ("Respond as {name} in conversation"). Varies by render_mode.
   - \`0010_setting.prompt\` — **World setting** (nearly empty by default). Best place for universal world-building or tone instructions that should affect ALL agents.
   - \`0020_format_rules.prompt\` — Loads guidelines (via \`render_subcomponent("guidelines")\`) and length constraints. Edit length rules HERE, not in guidelines.
   - \`0100_actor_bios.prompt\` — Character profile injection (template-heavy, do not edit)
   - \`0200_scene_context.prompt\` — Scene/location context injection (template-heavy, do not edit)
   - \`0250_omnisight.prompt\` — Visual descriptions (template-heavy, do not edit)
   - \`0400_speech_style_bio.prompt\` — Speech style reference (template-heavy, do not edit)
3. **\`submodules/guidelines/\`** — Loaded inside system_head via render_subcomponent. These are the **core behavioral rules**:
   - \`0500_roleplay_guidelines.prompt\` — **Roleplay behavior**: how to embody the character, use background/personality, react authentically. EDIT HERE for changes to roleplay quality, character depth, emotional authenticity.
   - \`0900_response_format.prompt\` — **Response format**: dialogue vs narration rules, asterisk usage, narration frequency, thought format. EDIT HERE for changes to output structure, narration behavior, formatting.
   - **To add new guidelines**: Create a new file like \`0600_custom.prompt\` (between 0500 and 0900) for new behavioral rules.

### Assembly Order (conversation history)
4. **\`components/event_history.prompt\`** — Formats conversation history as alternating user/assistant messages. Template-heavy — rarely needs editing.

### Assembly Order (final user message)
5. **\`submodules/user_final_instructions/\`** — Loaded in numerical order in the final user message:
   - \`0150_environmental_awareness.prompt\` — "Reference surroundings naturally"
   - \`0200_combat_status.prompt\` — Combat state injection
   - \`0650_audio_tags.prompt\` — TTS/audio tag instructions
   - \`0700_extra_instructions.prompt\` — Narration toggle reminder
   - \`0750_embedded_actions.prompt\` — Action system instructions
   - \`0800_direct_narration.prompt\` — Direct narration cues
   - \`8000_recent_state_changes.prompt\` — Recent state change summary
   - **To add final-turn instructions**: Create a new file here (e.g. \`0500_custom.prompt\`).

### Decision Guide — Where Should I Edit?
| Goal | Best file(s) to edit |
|------|---------------------|
| Improve roleplay depth, character authenticity | \`guidelines/0500_roleplay_guidelines.prompt\` |
| Change response length, format, narration rules | \`guidelines/0900_response_format.prompt\` |
| Add world-building, tone, or universal setting | \`system_head/0010_setting.prompt\` |
| Add new behavioral rules (new guideline) | Create \`guidelines/0600_custom.prompt\` (or similar number) |
| Add instructions for the final turn | Create or edit files in \`user_final_instructions/\` |
| Change task framing (rare) | \`system_head/0010_instructions.prompt\` |
| Change template structure (very rare) | \`dialogue_response.prompt\` |`;

    case "meta_eval":
      return `This agent uses **standalone target/speaker selector** prompts — they do NOT use system_head or guidelines submodules.

### Files
- **\`target_selectors/\`** — Target and speaker selection prompts. These are self-contained templates that evaluate who should speak next or who is being addressed.
- **\`components/event_history_compact.prompt\`** — Compact conversation history format.

Edit the selector prompts directly for changes to selection logic or criteria.`;

    case "action_eval":
      return `This agent uses the **native action selector** — a standalone prompt that does NOT use system_head or guidelines.

### Files
- **\`native_action_selector.prompt\`** — Evaluates which game action to perform after dialogue. Self-contained.
- **\`components/event_history_compact.prompt\`** — Compact conversation history format.

Edit the action selector directly for changes to action evaluation logic.`;

    case "game_master":
      return `This agent uses **Game Master** prompts — standalone templates that do NOT use system_head or guidelines.

### Files
- **\`gamemaster_action_selector.prompt\`** — GM decides what happens next (StartConversation, ContinueConversation, Narrate, None).
- **\`gamemaster_scene_planner.prompt\`** — Creates 4-6 beat scene plans.
- **\`components/event_history_compact.prompt\`** — Compact conversation history format.

Edit the GM prompts directly for changes to scene planning or action selection logic.`;

    case "memory_gen":
      return `This agent uses the **memory generation** pipeline. It does NOT use the full system_head — only the setting file.

### Files
- **\`submodules/system_head/0010_setting.prompt\`** — World setting (shared with dialogue). Edits here affect all agents that use it.
- **\`memory/generate_memory.prompt\`** — **Main memory generation template**. Edit here for changes to memory quality, format, or selection criteria.
- **\`components/event_history_verbose.prompt\`** — Verbose conversation history (more detail than compact).

Edit \`generate_memory.prompt\` for memory-specific changes. Edit \`0010_setting.prompt\` only for universal world-building.`;

    case "diary":
      return `This agent uses the **diary entry** pipeline. It uses the full system_head and guidelines (like dialogue), plus the diary template.

### Assembly Order
1. **\`submodules/system_head/\`** — Same as dialogue (instructions, setting, format rules, bios, scene)
2. **\`submodules/guidelines/\`** — Same roleplay/format guidelines as dialogue
3. **\`diary_entry.prompt\`** — **Main diary template**. Edit here for diary-specific changes.
4. **\`components/event_history_verbose.prompt\`** — Verbose conversation history.

### Decision Guide
| Goal | Best file to edit |
|------|------------------|
| Change diary writing style or format | \`diary_entry.prompt\` |
| Change roleplay depth (affects dialogue too) | \`guidelines/0500_roleplay_guidelines.prompt\` |
| Change world setting (affects all agents) | \`system_head/0010_setting.prompt\` |`;

    case "profile_gen":
      return `This agent uses the **bio update** pipeline. It does NOT use the full system_head — only the setting file.

### Files
- **\`submodules/system_head/0010_setting.prompt\`** — World setting (shared). Edits here affect all agents.
- **\`dynamic_bio_update.prompt\`** — **Main bio update template**. Edit here for changes to how character bios evolve.
- **\`components/event_history_verbose.prompt\`** — Verbose conversation history.

Edit \`dynamic_bio_update.prompt\` for bio-update-specific changes. This prompt enforces conservative updates ("95% should be MINIMAL or NO CHANGE").`;

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

The following prompt files are used by this agent. You can propose search/replace changes to modify them.
You can also **create new submodule files** by using an empty \`search_text\` and providing the full file content in \`replace_text\` with a \`file_path\` for the new file. Use numbered naming (e.g. \`0015_\`, \`0550_\`) to control load order — files load in numerical order within each submodule directory.
**IMPORTANT:** The file_path in each section header is the exact path you must use in your prompt_changes proposals. Copy it exactly. For new files, construct the path using the same base directory as existing files in that submodule.

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
${previousRounds.map((r) => {
  const resp = r.benchmarkResult?.response || "";
  const settingsChanges = r.proposal?.settingsChanges?.length
    ? `Settings changes: ${r.proposal.settingsChanges.map((c) => `${c.parameter}: ${JSON.stringify(c.oldValue)} → ${JSON.stringify(c.newValue)}`).join(", ")}`
    : "No settings changes";
  const promptChanges = r.proposal?.promptChanges?.length
    ? `Prompt changes: ${r.proposal.promptChanges.map((c) => `${c.filePath}: ${c.reason}`).join("; ")}`
    : "No prompt changes";
  const assessmentSummary = r.assessmentText
    ? `Assessment:\n${r.assessmentText.substring(0, 1200)}${r.assessmentText.length > 1200 ? "..." : ""}`
    : "Assessment: N/A";
  return `### Round ${r.roundNumber}
- Response: ${resp.substring(0, 600)}${resp.length > 600 ? "..." : ""}
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
  if (canModifyPrompts) allowedMods.push("prompt file content (via search/replace edits)");

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
${canModifyPrompts ? `7. **Choose the RIGHT file to edit.** Use the Pipeline Architecture guide above. The entry-point template (e.g. \`dialogue_response.prompt\`) is mostly structural scaffolding with template syntax — it is rarely the right place to edit. Instead:
   - For behavior/roleplay changes → edit files in \`submodules/guidelines/\`
   - For response format/length → edit \`guidelines/0900_response_format.prompt\` or \`system_head/0020_format_rules.prompt\`
   - For world-building/tone → edit \`system_head/0010_setting.prompt\`
   - For new rules that don't fit existing files → **create a new submodule file** with an appropriate number
   - For final-turn instructions → edit or create files in \`submodules/user_final_instructions/\`
   - Only edit entry-point templates if you need to change the structural assembly itself (very rare)
8. **For prompt changes: prefer adding over replacing.** The existing prompt files contain carefully crafted instructions tested across thousands of SkyrimNet NPC dialogues. Your default approach should be:
   - ADD new paragraphs or instructions after existing content
   - Make surgical wording changes to existing lines when a specific phrase is directly causing the problem
   - Only replace or rewrite a section if it directly conflicts with the improvement you're trying to make and a smaller edit won't fix it — and even then, preserve as much of the original intent as possible
   - Your \`search_text\` should be a SHORT, specific portion where possible; avoid replacing entire files or large blocks unnecessarily
   - To **create a new file**, use an empty \`search_text\` ("") and put the full file content in \`replace_text\`
9. **Prompt changes must be universal.** These prompts are used for THOUSANDS of different NPC dialogues across all of Skyrim — guards, merchants, innkeepers, quest characters, companions, etc. Proposed changes must improve dialogue quality for ANY NPC in ANY context. NEVER propose changes that are specific to the current benchmark scenario (e.g., referencing specific locations, quests, or NPC names from the test). Test your proposed instruction mentally: would it help a blacksmith AND a jarl AND a bard? If not, don't propose it.
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
10. **Avoid enabling reasoning.** For SkyrimNet roleplay agents, \`allowReasoning: false\` produces better results 9 times out of 10. Reasoning adds latency and token cost without improving dialogue quality. Only enable it if the task requires complex multi-step logical analysis (not creative text generation).
11. **Ignore self-explanation quality.** The model's self-explanation is generated in a separate diagnostic call with its own token budget. Changing inference settings (especially maxTokens) will NOT affect explanation verbosity. Focus only on the actual benchmark response quality.${ignoreFormatScoring ? `
12. **IGNORE FORMAT.** The user has opted to skip format scoring. Do NOT propose changes aimed at fixing format, JSON structure, metadata fields, importance scores, emotion fields, or any output format aspects. The output format is dictated by SkyrimNet's engine requirements and is correct as-is. Focus exclusively on content quality, accuracy, and efficiency.` : ""}
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
    { "file_path": "/absolute/path/to/file.prompt", "search_text": "exact text to find", "replace_text": "replacement text", "reason": "why this change helps" },
    { "file_path": "/absolute/path/to/new_file.prompt", "search_text": "", "replace_text": "full file content here", "reason": "creating new submodule file" }
  ]` : ""}
}

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
