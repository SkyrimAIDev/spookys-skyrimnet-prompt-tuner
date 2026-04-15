import type { BenchmarkCategory } from "@/types/benchmark";
import type { PromptEditingMode } from "@/types/autotuner";
import type { PromptChange } from "@/types/autotuner";

/**
 * Maps each benchmark category → the recommended prompt files for editing.
 * These are the most impactful prompts for each agent, containing mostly
 * editable prose with clear guidelines for what can/can't be modified.
 *
 * Paths are relative to the prompt set base (e.g. "submodules/guidelines/0500_roleplay_guidelines.prompt").
 */
export const RECOMMENDED_PROMPTS: Record<BenchmarkCategory, string[]> = {
  dialogue: [
    "submodules/guidelines/0500_roleplay_guidelines.prompt",
    "submodules/guidelines/0900_response_format.prompt",
    "submodules/system_head/0010_setting.prompt",
  ],
  meta_eval: [
    "target_selectors/dialogue_speaker_selector.prompt",
    "target_selectors/player_dialogue_target_selector.prompt",
  ],
  action_eval: [
    "native_action_selector.prompt",
  ],
  game_master: [
    "gamemaster_action_selector.prompt",
    "gamemaster_scene_planner.prompt",
  ],
  memory_gen: [
    "memory/generate_memory.prompt",
  ],
  diary: [
    "diary_entry.prompt",
  ],
  bio_update: [
    "dynamic_bio_update.prompt",
  ],
};

/**
 * Per-prompt editing instructions for the tuner LLM.
 * Keyed by the filename (last segment of the path).
 * These tell the LLM exactly what each prompt does and how to edit it safely.
 */
export const PROMPT_EDITING_GUIDES: Record<string, string> = {
  // ── Dialogue Agent ──────────────────────────────────────────────────
  "0500_roleplay_guidelines.prompt": `**Purpose:** Establishes roleplay identity guidelines for the NPC character.
**Structure:** Mixed prose + Inja logic. Has render_mode branching (thoughts/book vs normal) and a combat detection conditional.
**Template logic (DO NOT TOUCH):**
- \`{% if render_mode == "thoughts" or render_mode == "book" %}\` / \`{% else %}\` / \`{% endif %}\`
- \`{% if decnpc(npc.UUID).isInCombat %}\` / \`{% endif %}\`
- \`{{ decnpc(npc.UUID).name }}\` — dynamic NPC name insertion
**Safe to edit:**
- The prose text WITHIN each conditional branch (the instructions, not the conditions)
- Line about "silent inner thought" in thoughts/book branch
- The "Embody [name] fully" paragraph in the normal branch — expand with personality anchors, emotional guidance
- The combat instruction — add urgency guidance, combat-specific behavior
**Good edits:** Rewording roleplay instructions for clarity, adding personality engagement guidance, expanding combat behavior rules
**Bad edits:** Changing conditional logic, modifying template function calls, removing endif tags`,

  "0900_response_format.prompt": `**Purpose:** Defines output formatting rules — the most complex dialogue prompt with deeply nested conditionals.
**Structure:** ~45% template logic, ~55% editable prose. Has 3 levels of nesting controlling 5 output branches:
  1. Thoughts mode + narration enabled
  2. Thoughts mode + narration disabled
  3. Dialogue mode + narration + actions available
  4. Dialogue mode + narration + no actions
  5. Dialogue mode + no narration
**Template logic (DO NOT TOUCH):**
- All \`{% if %}\` / \`{% else %}\` / \`{% endif %}\` lines — these control which formatting rules apply at runtime
- \`render_mode\`, \`is_narration_enabled()\`, \`embed_actions_in_dialogue\`, \`eligible_actions\` checks
- \`{{ decnpc(npc.UUID).name }}\` — appears 5 times for examples
**Safe to edit (WITHIN each branch):**
- "No headers or labels" instruction (line after ## Response Format)
- Thoughts mode: first-person perspective rules, sentence limits, physical action guidance
- Dialogue mode: narration frequency ("1 in 4 responses"), what counts as narration vs action
- RIGHT/WRONG examples — add more or rephrase existing ones
- "Each response must advance the conversation" — expand with specific tactics
- Skip-trivial-filler list — expand or adjust
**Good edits:** Adjusting narration frequency, adding better RIGHT/WRONG examples, clarifying what "advance the conversation" means, tuning response length guidance
**Bad edits:** Removing or rearranging any conditional blocks, changing the nesting structure, modifying function calls`,

  "0010_setting.prompt": `**Purpose:** The world setting header — the PRIMARY user customization point for global world/tone rules.
**Structure:** Minimal scaffold — just a markdown header and comments. Almost entirely open for adding content.
**Template logic (DO NOT TOUCH):**
- \`{# ... #}\` comment blocks (Inja comments)
- \`{{ "# Setting" }}\` — renders the section header
**Safe to edit:**
- ADD new prose content AFTER the header line — this is where world-building text goes
- Describe the Skyrim variant, world rules, tone, atmosphere, historical context
- Add subsections like "## World Rules", "## Atmosphere"
**Good edits:** Adding rich setting descriptions that shape NPC behavior globally — e.g. "Skyrim is gripped by civil war. NPCs distrust strangers." or "Magic is feared and misunderstood by common folk."
**Bad edits:** Removing the header output line, breaking Inja comment syntax. Keep additions concise (max context is 4096 tokens).`,

  // ── Meta Evaluation Agent ───────────────────────────────────────────
  "dialogue_speaker_selector.prompt": `**Purpose:** Determines which NPC should speak next in a dialogue sequence, or whether silence is appropriate.
**Structure:** ~35% template, ~65% editable prose. System section has selection criteria, User section has dynamic data.
**Template logic (DO NOT TOUCH):**
- \`{{ lastSpeaker.name }}\` — current speaker name
- \`{{ get_scene_context(0, 0, "full") }}\` — scene context function
- \`{{ location }}\`, \`{{ render_template("components\\\\event_history_compact") }}\`
- The entire \`{% for candidate in candidateDialogues %}\` loop with nested \`{% if decnpc(candidate.UUID).isVirtual %}\` checks
- All \`{{ render_character_profile(...) }}\` calls
**Safe to edit:**
- Task description (lines 2-3 of the system section)
- Output format examples — rephrase for clarity
- Selection criteria list (5 numbered items) — reword, reorder, add criteria
- Restrictions section — rephrase "silence is natural and preferred", "honor interjection guidance"
- Output format reminder at the end
**Good edits:** Clarifying when silence is preferred, adding nuance to selection criteria (emotional involvement, conversational relevance), improving examples
**Bad edits:** Changing the output format (must remain 0 or [NPC]>[target]), weakening Virtual NPC constraints, removing the silence-is-preferred principle`,

  "player_dialogue_target_selector.prompt": `**Purpose:** Determines WHO the player is addressing — direct speech, prompting NPC-to-NPC dialogue, or general/group speech.
**Structure:** ~40% template, ~60% editable prose. Handles three interaction types with distance-based targeting.
**Template logic (DO NOT TOUCH):**
- \`{{ get_scene_context(player.UUID, 0, "target_selection") }}\` — player scene context
- \`{{ triggeringEvent.type }}\`, \`{{ format_event(triggeringEvent, "verbose") }}\`
- \`{% if crosshairTarget %}\` conditional block with \`{{ crosshairTarget.name }}\`, \`{{ units_to_meters(crosshairTarget.distance) }}\`
- \`{{ render_template("components\\\\event_history_compact") }}\`
- All variable interpolations in the user section
**Safe to edit:**
- System role description
- The three interaction types explanation (direct, NPC-to-NPC prompted, group/general)
- Distance priority guidance — "distance is a very strong factor"
- Selection criteria for direct dialogue and NPC-to-NPC dialogue
- Output format guidelines and examples
**Good edits:** Adding examples of ambiguous player dialogue, clarifying distance thresholds, improving NPC-to-NPC detection heuristics
**Bad edits:** Changing output format (must remain 0 / [NPC]>player / [NPC]>[target]), weakening Virtual NPC rules, inverting distance priority`,

  // ── Action Evaluation Agent ─────────────────────────────────────────
  "native_action_selector.prompt": `**Purpose:** Selects an in-game action (animation, gesture, combat move) that matches the NPC's dialogue response.
**Structure:** ~45% template, ~55% editable prose. Has a critical JSON/plain-text output format conditional.
**Template logic (DO NOT TOUCH):**
- \`{{ npc.name }}\` — appears multiple times
- \`{% if structured_json_actions %}\` — major conditional controlling output format (JSON vs plain text)
- \`{{ render_character_profile("full", npc.UUID) }}\` — character profile render
- \`{{ location }}\`, \`{{ dialogue_request }}\`, \`{{ dialogue_response }}\`
- \`{% for action in eligible_actions %}\` loop with \`{{ action.name }}\`, \`{{ action.parameterSchema }}\`, \`{{ action.description }}\`
- All player/NPC loop blocks in the user section
**Safe to edit:**
- Core principle text: "Your choice must directly reflect what [NPC] just said"
- "NEVER pick random actions" instruction — rephrase or expand
- Context labels and descriptions
- Format reminders and examples in both JSON and plain text branches
**Good edits:** Adding examples of good action-dialogue matches, clarifying what "directly reflects" means, improving format instructions
**Bad edits:** Breaking the structured_json_actions conditional, changing the action loop, loosening "NEVER pick random actions"`,

  // ── Game Master Agent ───────────────────────────────────────────────
  "gamemaster_action_selector.prompt": `**Purpose:** Scene director — decides what happens next (StartConversation, ContinueConversation, Narrate, or None). The most complex prompt (~168 lines).
**Structure:** ~60% template, ~40% editable prose. Heavy conditional logic for continuous mode, scene plans, and enabled actions.
**Template logic (DO NOT TOUCH):**
- \`{% if not is_continuous_mode %}\` — mode detection
- \`{% if is_action_enabled("StartConversation") %}\` / \`{% if is_action_enabled("ContinueConversation") %}\` — conditional action docs
- \`{% if is_continuous_mode %}\` with nested \`{% if has_scene_plan and scene_plan %}\` — scene plan display
- All scene_plan property interpolations (\`{{ scene_plan.scene_summary }}\`, beat loops, etc.)
- \`{% for npc in get_nearby_npc_list(player.UUID) %}\` — NPC enumeration
- \`{% for action in eligible_actions %}\` — action list
- All \`{{ render_template(...) }}\`, \`{{ render_character_profile(...) }}\` calls
**Safe to edit:**
- "Your Role" principles (lines 15-21) — storyteller observation, credible reactions, world-shaping
- "Reading the Scene" guidelines — event type explanations
- When to use StartConversation / ContinueConversation sections (within their conditionals)
- Target selection priority guidance
- Topic format and examples
- "Style" section — pure prose philosophy, highly editable
**Good edits:** Refining scene-direction philosophy, adding examples of good pacing, clarifying NPC-to-NPC interaction priority, improving topic suggestions
**Bad edits:** Breaking any conditional blocks, removing "prioritize NPC-to-NPC interactions", weakening the character name matching warning, changing output format`,

  "gamemaster_scene_planner.prompt": `**Purpose:** Creates a 4-6 beat scene plan (JSON) that guides the gamemaster_action_selector.
**Structure:** ~40% template, ~60% editable prose. Contains a critical \`{% raw %}\` block protecting the JSON schema.
**Template logic (DO NOT TOUCH):**
- \`{{ location.name }}\`, \`{% if location.description %}\`, \`{{ time_desc }}\`
- \`{% for npc in get_nearby_npc_list(player.UUID) %}\` — NPC availability loop
- All \`{{ decnpc(...) }}\`, \`{{ render_character_profile(...) }}\` calls
- \`{% raw %}...{% endraw %}\` block — protects the JSON response format from Inja parsing
- \`{{ render_template("components\\\\event_history_compact") }}\`
**Safe to edit:**
- Role and task description (lines 2-7)
- "The Player is UNCONTROLLABLE" section — reword principles about player unpredictability
- "Scene Planning Guidelines" — what makes a good scene (5 principles)
- "Beat Types to Consider" — dialogue-first approach guidance
- "Player Independence" philosophy section
- Requirements section — beat count (4-6), dialogue-first priority, narration limits (0-1 beats)
**Good edits:** Refining scene pacing philosophy, adding beat type examples, clarifying the dialogue-first approach, improving player independence guidance
**Bad edits:** Breaking the raw block, changing JSON structure, removing the 4-6 beat requirement, inverting dialogue vs narration priority`,

  // ── Memory Generation Agent ─────────────────────────────────────────
  "generate_memory.prompt": `**Purpose:** Generates first-person memories for NPCs from recent game events. Outputs JSON with content, emotion, importance, tags, type.
**Structure:** ~20% template, ~80% editable prose. Most of the file is guidelines and examples.
**Template logic (DO NOT TOUCH):**
- \`{{ render_template("submodules\\\\system_head\\\\0010_setting") }}\` — setting include
- \`{{ actor_name }}\`, \`{{ current_location }}\`, \`{{ num_events }}\`
- \`{{ render_character_profile("full", actor_uuid) }}\` — character profile
- \`{% for actor in actors_involved %}\` loop with all actor fields
- \`{{ render_template("components\\\\event_history_verbose") }}\`
- \`{% raw %}...{% endraw %}\` block — JSON response format
**Safe to edit:**
- Preamble text
- Numbered instructions (density, perspective, emotional anchoring)
- "3-5 dense sentences max" — adjust length guidance
- All guidelines and examples sections — memory types, emotional range, quality examples
- Style guidance for memory writing
**Good edits:** Refining memory density/length, improving emotional range examples, adding memory type guidance, clarifying what makes a memory "significant"
**Bad edits:** Breaking template includes, changing JSON field names (content, location, emotion, importanceScore, tags, type), breaking the raw block`,

  // ── Diary Agent ─────────────────────────────────────────────────────
  "diary_entry.prompt": `**Purpose:** Generates deeply personal, emotional diary entries for NPCs. The diary captures private thoughts and vulnerabilities.
**Structure:** ~15% template, ~85% editable prose. Extensive philosophical guidance about introspection and emotional processing.
**Template logic (DO NOT TOUCH):**
- \`{{ decnpc(npc.UUID).name }}\` — NPC name (appears in system and user sections)
- \`{{ render_subcomponent("system_head", "full") }}\` — full system head include
- \`{% if lastDiaryEntry %}\` ... \`{% endif %}\` — previous diary conditional
- \`{% if recentMemories and length(recentMemories) > 0 %}\` with \`{% for memory in recentMemories %}\` loop
- \`{{ render_template("components\\\\event_history_verbose") }}\`
- \`{{ targetEntryLength }}\` — word count target variable
**Safe to edit:**
- System guidelines (tone, approach, emotional depth)
- All 10 numbered instruction points — introspection depth, emotional processing, writing style
- Style specifications and length guidance
- Tone descriptions ("Private, unfiltered, genuine")
- Field definitions for JSON response
**Good edits:** Deepening emotional introspection guidance, adding writing style examples, adjusting length targets, refining what "genuine" means in diary context
**Bad edits:** Breaking conditionals for lastDiaryEntry/recentMemories, changing JSON field names (importance_score, emotion, content)`,

  // ── Bio Update Agent ────────────────────────────────────────────────
  "dynamic_bio_update.prompt": `**Purpose:** Conservatively updates character biographies based on recent events. The longest and most philosophical prompt.
**Structure:** ~15% template (but spread throughout), ~85% editable prose. Extensive guidance on preservation vs change.
**Template logic (DO NOT TOUCH):**
- \`{{ render_template("submodules\\\\system_head\\\\0010_setting") }}\` — setting include
- Character info block: \`{{ actor.displayName }}\`, \`{{ actor.level }}\`, \`{{ actor.race.name }}\`, etc.
- \`{% if factions and length(factions) > 0 %}\` with \`{% for faction in factions %}\` loop
- \`{{ render_template("components\\\\event_history_verbose") }}\`
- \`{% if recentMemories %}\` with \`{% for memory in recentMemories %}\` loop
- \`{% set latestDiary = get_latest_diary_entry(actor.UUID) %}\` — variable assignment
- \`{% if latestDiary and latestDiary.content %}\` — diary conditional
- \`{{ originalBioContent }}\`, \`{{ currentDynamicContent }}\` — bio content variables
- \`{% for block in updatableBlocks %}\` — block list
- \`{% if preserveCorePersonality %}\` — preservation conditional
**Safe to edit:**
- Core philosophy ("conservative update" approach)
- Bio block definitions and what each block means
- Update thresholds (what constitutes a significant vs routine event)
- Content pruning guidelines
- Proportional change guidelines
- Integration vs replacement decision matrix
- Update guidelines organized by event type
- Numbered update instructions
**Good edits:** Refining conservation thresholds, improving pruning heuristics, adding event-type-specific guidance, clarifying what "significant" means for bio changes
**Bad edits:** Breaking any conditional blocks, modifying variable assignments ({% set %}), changing JSON field names (updated_content, changes_summary), removing the preservation philosophy`,
};

/**
 * Maps category → the submodule directory where new prompts should be created.
 * Tuner LLM uses this to know the correct location and naming scheme for new files.
 */
export const NEW_PROMPT_LOCATIONS: Record<BenchmarkCategory, { directory: string; numberingHint: string }> = {
  dialogue: {
    directory: "submodules/guidelines",
    numberingHint: "Use a 4-digit prefix between existing files, e.g. 0400_conversational_variety.prompt, 0550_dialogue_style.prompt, 0650_writing_quality.prompt, 0800_conversation_flow.prompt. Files load in numerical order.",
  },
  meta_eval: {
    directory: "target_selectors",
    numberingHint: "This directory has only the selector prompts. Add supplementary files with a numeric prefix, e.g. 0010_selection_guidelines.prompt.",
  },
  action_eval: {
    directory: ".",
    numberingHint: "The action selector is a standalone file. Create supplementary files at the prompts root with a numeric prefix, e.g. 0010_action_guidelines.prompt.",
  },
  game_master: {
    directory: ".",
    numberingHint: "GM prompts are standalone files at the prompts root. Create supplementary files with a numeric prefix, e.g. 0010_gm_guidelines.prompt.",
  },
  memory_gen: {
    directory: "memory",
    numberingHint: "The memory directory has generate_memory.prompt. Add supplementary files with a numeric prefix, e.g. 0010_memory_guidelines.prompt.",
  },
  diary: {
    directory: ".",
    numberingHint: "diary_entry.prompt is a standalone file. Create supplementary files at the prompts root with a numeric prefix, e.g. 0010_diary_guidelines.prompt.",
  },
  bio_update: {
    directory: ".",
    numberingHint: "dynamic_bio_update.prompt is a standalone file. Create supplementary files at the prompts root with a numeric prefix, e.g. 0010_bio_guidelines.prompt.",
  },
};

/**
 * Enforce prompt editing mode constraints at the code level.
 *
 * Validates each LLM-proposed change against the per-mode rules using **exact
 * canonical relative paths** — no basename matching, no fuzzy parsing. The
 * `whitelist` parameter is the set of files actually shown to the LLM in this
 * round (built from fetchPromptContent). Any change.filePath not in the
 * whitelist (for edit modes) or violating the create rules (for create modes)
 * is rejected and fed back to the LLM via the redirect retry loop.
 *
 * Mode rules:
 * - **recommended** / **world_settings** / **custom** — must be an exact match
 *   against the whitelist. No file creation allowed.
 * - **new_prompt** — must be a NEW file (not in whitelist) under the agent's
 *   `newLocation.directory`, ending in `.prompt`.
 * - **auto** — must be an exact whitelist match (edit) OR a new file under the
 *   agent's `newLocation.directory` (create).
 */
export function enforcePromptEditingMode(
  changes: PromptChange[],
  mode: PromptEditingMode,
  category: BenchmarkCategory,
  customPaths?: string[],
  whitelist?: string[],
): { allowed: PromptChange[]; rejected: PromptChange[] } {
  const allowed: PromptChange[] = [];
  const rejected: PromptChange[] = [];

  // Build the per-mode allowed-edit set from the whitelist actually shown.
  let allowedEdits: Set<string> = new Set();
  if (mode === "recommended") {
    allowedEdits = new Set(RECOMMENDED_PROMPTS[category] || []);
  } else if (mode === "world_settings") {
    allowedEdits = new Set(["submodules/system_head/0010_setting.prompt"]);
  } else if (mode === "custom") {
    allowedEdits = new Set(customPaths || []);
  } else if (mode === "auto" || mode === "new_prompt") {
    // Edits are restricted to files actually shown to the LLM this round.
    allowedEdits = new Set(whitelist || []);
  }

  // Create rules — only meaningful for modes that allow creation
  const newLocation = NEW_PROMPT_LOCATIONS[category];
  const allowsCreate = mode === "new_prompt" || mode === "auto";
  const createDirPrefix = newLocation
    ? (newLocation.directory === "." ? "" : newLocation.directory.replace(/\/+$/, "") + "/")
    : null;

  const isValidCreate = (path: string): boolean => {
    if (!allowsCreate || createDirPrefix === null) return false;
    if (!path.endsWith(".prompt")) return false;
    // Reject path-traversal and absolute paths upfront
    if (path.includes("..") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
    if (createDirPrefix === "") {
      // Root-level create — must have no slashes (a single file at the prompts root)
      return !path.includes("/");
    }
    return path.startsWith(createDirPrefix);
  };

  for (const change of changes) {
    const path = change.filePath;

    // Edit path: exact whitelist match
    if (allowedEdits.has(path)) {
      allowed.push(change);
      continue;
    }

    // Create path: only for new_prompt / auto modes
    if (isValidCreate(path)) {
      allowed.push(change);
      continue;
    }

    // Build a clear reject reason that the redirect retry loop can show to the LLM.
    let reason: string;
    if (mode === "new_prompt") {
      reason = `[BLOCKED] "${path}" is not a valid new file location. New files must be under "${newLocation?.directory}" and end in ".prompt".`;
    } else if (mode === "auto") {
      reason = `[BLOCKED] "${path}" is not in the available files menu and is not a valid new file location (must be under "${newLocation?.directory}").`;
    } else {
      reason = `[BLOCKED] "${path}" is not in the ${mode} allowed list. Must be an exact match against the file menu.`;
    }
    rejected.push({
      ...change,
      reason: `${reason} ${change.reason}`,
      modifiedContent: "",
    });
  }

  return { allowed, rejected };
}
