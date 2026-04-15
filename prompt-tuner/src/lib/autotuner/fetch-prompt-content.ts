import type { BenchmarkCategory, BenchmarkNpc } from "@/types/benchmark";
import { getCategoryDef } from "@/lib/benchmark/categories";

/**
 * Maps agent types to prompt paths for tuning.
 * Entries ending in .prompt are individual files; others are directories to list.
 */
/**
 * Maps agent types to prompt paths that are ACTUALLY rendered by each agent's
 * pipeline. Entries ending in .prompt are individual files; others are
 * directories to list. Only include files that are part of the rendered prompt
 * — the tuner should see exactly what the model sees.
 *
 * Character bios (submodules/character_bio/*, characters/*.prompt) are handled
 * separately as read-only context further down.
 */
/**
 * File editability tags used to annotate prompt files for the tuner LLM.
 * EDITABLE — safe to modify, mostly plain-text instructions
 * EDIT_WITH_CARE — mix of template and text; edit only the prose portions
 * DO_NOT_EDIT — heavy template logic or structural scaffolding; show as read-only context
 */
type Editability = "EDITABLE" | "EDIT_WITH_CARE" | "DO_NOT_EDIT";

/**
 * Map file names → editability. Entries not listed default to EDIT_WITH_CARE.
 */
export const FILE_EDITABILITY: Record<string, Editability> = {
  // ── SAFE to edit (mostly plain-text instructions) ──
  "0010_setting.prompt": "EDITABLE",
  "0500_roleplay_guidelines.prompt": "EDITABLE",
  "0900_response_format.prompt": "EDITABLE",
  "diary_entry.prompt": "EDITABLE",
  "dynamic_bio_update.prompt": "EDITABLE",
  "generate_memory.prompt": "EDITABLE",
  "gamemaster_scene_planner.prompt": "EDITABLE",
  // ── Edit with care (some template branching) ──
  "0010_instructions.prompt": "EDIT_WITH_CARE",
  "0020_format_rules.prompt": "EDIT_WITH_CARE",
  "dialogue_response.prompt": "EDIT_WITH_CARE",
  "native_action_selector.prompt": "EDIT_WITH_CARE",
  "gamemaster_action_selector.prompt": "EDIT_WITH_CARE",
  "0150_environmental_awareness.prompt": "EDIT_WITH_CARE",
  "0700_extra_instructions.prompt": "EDIT_WITH_CARE",
  "0750_embedded_actions.prompt": "EDIT_WITH_CARE",
  "dialogue_speaker_selector.prompt": "EDIT_WITH_CARE",
  "player_dialogue_target_selector.prompt": "EDIT_WITH_CARE",
  // ── DO NOT EDIT (pure template scaffolding) ──
  "0100_actor_bios.prompt": "DO_NOT_EDIT",
  "0200_scene_context.prompt": "DO_NOT_EDIT",
  "0250_omnisight.prompt": "DO_NOT_EDIT",
  "0400_speech_style_bio.prompt": "DO_NOT_EDIT",
  "event_history.prompt": "DO_NOT_EDIT",
  "event_history_compact.prompt": "DO_NOT_EDIT",
  "event_history_verbose.prompt": "DO_NOT_EDIT",
  "0200_combat_status.prompt": "DO_NOT_EDIT",
  "0650_audio_tags.prompt": "DO_NOT_EDIT",
  "0800_direct_narration.prompt": "DO_NOT_EDIT",
  "8000_recent_state_changes.prompt": "DO_NOT_EDIT",
};

function getEditability(fileName: string): Editability {
  // Strip path to just filename
  const base = fileName.split("/").pop() || fileName;
  return FILE_EDITABILITY[base] || "EDIT_WITH_CARE";
}

const EDITABILITY_LABELS: Record<Editability, string> = {
  EDITABLE: "EDITABLE — safe to modify",
  EDIT_WITH_CARE: "EDIT WITH CARE — has template logic, edit prose only",
  DO_NOT_EDIT: "DO NOT EDIT — template scaffolding, read-only context",
};

export const AGENT_PROMPT_PATHS: Record<string, string[]> = {
  // dialogue_response.prompt renders: system_head (full), event_history,
  // user_final_instructions, character bio, scene context.
  // system_head/0020_format_rules.prompt internally calls
  // render_subcomponent("guidelines") which loads the guidelines submodule —
  // include it explicitly so the tuner can see and edit the actual rules.
  default: [
    "submodules/system_head",
    "submodules/guidelines",
    "submodules/user_final_instructions",
    "dialogue_response.prompt",
    "components/event_history.prompt",
  ],
  // meta_eval renders two standalone target selectors — NO system_head
  // Both use event_history_compact
  meta_eval: [
    "target_selectors",
    "components/event_history_compact.prompt",
  ],
  // native_action_selector.prompt is standalone — NO system_head
  // Uses event_history_compact
  action_eval: [
    "native_action_selector.prompt",
    "components/event_history_compact.prompt",
  ],
  // Both GM templates are standalone — NO system_head
  // Both use event_history_compact
  game_master: [
    "gamemaster_action_selector.prompt",
    "gamemaster_scene_planner.prompt",
    "components/event_history_compact.prompt",
  ],
  // memory/generate_memory.prompt uses ONLY 0010_setting.prompt (not full system_head)
  // Uses event_history_verbose
  memory_gen: [
    "submodules/system_head/0010_setting.prompt",
    "memory/generate_memory.prompt",
    "components/event_history_verbose.prompt",
  ],
  // diary_entry.prompt renders: system_head (full), event_history_verbose
  // system_head includes guidelines via render_subcomponent("guidelines")
  diary: [
    "submodules/system_head",
    "submodules/guidelines",
    "diary_entry.prompt",
    "components/event_history_verbose.prompt",
  ],
  // dynamic_bio_update.prompt uses ONLY 0010_setting.prompt (not full system_head)
  // Uses event_history_verbose
  profile_gen: [
    "submodules/system_head/0010_setting.prompt",
    "dynamic_bio_update.prompt",
    "components/event_history_verbose.prompt",
  ],
};

// ── Content limits ──────────────────────────────────────────────────
const MAX_TOTAL_CONTENT_LENGTH = 30000;
const PRIMARY_NPC_BIO_LIMIT = 8000;
const SECONDARY_NPC_BIO_LIMIT = 2000;
const EDITABLE_FILE_LIMIT = 4000;
const READ_ONLY_FILE_LIMIT = 800;

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

/**
 * Resolve a prompt set name (e.g. "__tuner_temp__", "Test_3", "")
 * to an absolute base path via the server-side resolve API.
 */
async function resolveBasePath(promptSetName: string): Promise<string> {
  const resp = await fetch(
    `/api/files/resolve-prompt-set?name=${encodeURIComponent(promptSetName)}`,
  );
  if (!resp.ok) {
    throw new Error(`Failed to resolve prompt set "${promptSetName}": HTTP ${resp.status}`);
  }
  const { basePath } = await resp.json();
  return basePath;
}

/**
 * Try reading a file by absolute path. No fallback — use tryReadPrompt for set-aware resolution.
 */
async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    const resp = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
    if (!resp.ok) return null;
    const { content } = await resp.json();
    return content ?? null;
  } catch {
    return null;
  }
}

/**
 * Read a prompt file by relative path with set-aware fallback resolution.
 * Tries: promptSet → fallbackSets → originals (server-side).
 */
async function tryReadPrompt(
  relativePath: string,
  promptSet?: string,
  fallbackSets?: string[],
): Promise<string | null> {
  try {
    const resp = await fetch("/api/files/read-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relativePath, promptSet, fallbackSets: fallbackSets || [] }),
    });
    if (!resp.ok) return null;
    const { content } = await resp.json();
    return content ?? null;
  } catch {
    return null;
  }
}

/**
 * Try listing .prompt children in a directory, returning entries or empty array.
 */
async function tryListPromptFiles(dirPath: string): Promise<FileEntry[]> {
  try {
    const resp = await fetch(`/api/files/children?path=${encodeURIComponent(dirPath)}&limit=50`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.nodes || data.children || [])
      .filter((e: FileEntry) => e.type === "file" && e.name.endsWith(".prompt"))
      .sort((a: FileEntry, b: FileEntry) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Fetch relevant prompt file contents for a category.
 * Resolves the prompt set name to an absolute path server-side,
 * then reads files via the children + read APIs.
 *
 * When using a temp set (e.g. __tuner_temp__), files may not exist there yet.
 * Falls back to fallbackSetName (the active prompt set) for any missing
 * files/directories, then to originals. Returns paths using the primary set
 * so the LLM targets the correct writable location in its proposals.
 *
 * If scenarioNpcs are provided, their character bio files are included
 * as read-only context so the tuner LLM understands the NPCs involved.
 */
/**
 * One file shown to the tuner LLM. `relativePath` is the canonical
 * forward-slash path relative to a prompt set's prompts/ root, e.g.
 * "submodules/system_head/0010_setting.prompt". This is the ONLY identifier
 * the LLM sees and the only identifier accepted in proposal `file_path`
 * fields downstream. No absolute paths anywhere in the LLM-facing pipeline.
 */
export interface PromptFileEntry {
  relativePath: string;
  content: string;
  editability: "EDITABLE" | "EDIT_WITH_CARE" | "DO_NOT_EDIT";
}

export async function fetchPromptContent(
  category: BenchmarkCategory,
  promptSetName: string,
  fallbackSetName?: string,
  scenarioNpcs?: BenchmarkNpc[],
): Promise<{ content: string; files: PromptFileEntry[] }> {
  const catDef = getCategoryDef(category);
  if (!catDef) return { content: "", files: [] };

  const agent = catDef.agent;
  // Always fetch all agent paths — the editing mode is enforced in the LLM instructions,
  // not by filtering which files are shown. The LLM needs full context to make good edits.
  const paths = AGENT_PROMPT_PATHS[agent] || ["submodules/system_head"];

  // Resolve the set name to an absolute base path on disk
  let basePath: string;
  try {
    basePath = await resolveBasePath(promptSetName);
  } catch {
    console.error(`[fetchPromptContent] Could not resolve prompt set "${promptSetName}"`);
    return { content: "", files: [] };
  }

  // Build fallback chain: active prompt set first, then originals
  const fallbackBasePaths: string[] = [];
  if (promptSetName) {
    if (fallbackSetName) {
      try {
        fallbackBasePaths.push(await resolveBasePath(fallbackSetName));
      } catch { /* skip */ }
    }
    try {
      const originalsPath = await resolveBasePath("");
      // Avoid duplicate if fallback already resolved to originals
      if (!fallbackBasePaths.includes(originalsPath)) {
        fallbackBasePaths.push(originalsPath);
      }
    } catch { /* skip */ }
  }

  const allFiles: PromptFileEntry[] = [];
  let totalLength = 0;
  const MAX_TOTAL = MAX_TOTAL_CONTENT_LENGTH;

  for (const entry of paths) {
    if (totalLength > MAX_TOTAL) break;

    const fullPath = `${basePath}/${entry}`.replace(/\\/g, "/");
    const fallbackPaths = fallbackBasePaths.map(
      (fb) => `${fb}/${entry}`.replace(/\\/g, "/")
    );

    try {
      if (entry.endsWith(".prompt")) {
        // Individual file — use set-aware resolution with fallbacks
        const fallbackSetNames = fallbackSetName ? [fallbackSetName, "__original__"] : ["__original__"];
        const content = await tryReadPrompt(entry, promptSetName || undefined, fallbackSetNames);
        if (content === null) continue;

        allFiles.push({ relativePath: entry, content, editability: getEditability(entry) });
        totalLength += content.length;
      } else {
        // Directory — merge primary listing with fallback listings so that
        // files modified in the temp set are read from there, while unmodified
        // files are still included from the source/original set.
        const primaryFiles = await tryListPromptFiles(fullPath);
        const seenNames = new Set(primaryFiles.map((f) => f.name));
        const mergedNames: string[] = primaryFiles.map((f) => f.name);

        for (const fb of fallbackPaths) {
          const fbFiles = await tryListPromptFiles(fb);
          for (const f of fbFiles) {
            if (!seenNames.has(f.name)) {
              seenNames.add(f.name);
              mergedNames.push(f.name);
            }
          }
        }
        mergedNames.sort((a, b) => a.localeCompare(b));

        const fallbackSetNames = fallbackSetName ? [fallbackSetName, "__original__"] : ["__original__"];
        for (const name of mergedNames) {
          if (totalLength > MAX_TOTAL) break;
          const relPath = `${entry}/${name}`;
          const content = await tryReadPrompt(relPath, promptSetName || undefined, fallbackSetNames);
          if (content === null) continue;
          allFiles.push({ relativePath: relPath, content, editability: getEditability(relPath) });
          totalLength += content.length;
        }
      }
    } catch {
      // Skip inaccessible paths
    }
  }

  // ── Fetch character bios for scenario NPCs (read-only context) ──
  const bioSections: string[] = [];
  if (scenarioNpcs && scenarioNpcs.length > 0) {
    // Try reading bios from the fallback chain (active set → originals)
    // Character bios live in characters/<uuid>.prompt
    const bioBasePaths = [basePath, ...fallbackBasePaths];
    for (let npcIdx = 0; npcIdx < scenarioNpcs.length; npcIdx++) {
      if (totalLength > MAX_TOTAL) break;
      const npc = scenarioNpcs[npcIdx];
      const uuid = npc.uuid;
      if (!uuid) continue;

      let bioContent: string | null = null;
      for (const bp of bioBasePaths) {
        const bioPath = `${bp}/characters/${uuid}.prompt`.replace(/\\/g, "/");
        bioContent = await tryReadFile(bioPath);
        if (bioContent !== null) break;
      }
      if (bioContent) {
        // Primary NPC (first in list) gets a much higher limit so the tuner
        // can see the full personality, speech_style, etc. Nearby NPCs are shorter.
        const bioMaxLen = npcIdx === 0 ? PRIMARY_NPC_BIO_LIMIT : SECONDARY_NPC_BIO_LIMIT;
        const truncated = bioContent.length > bioMaxLen
          ? bioContent.substring(0, bioMaxLen) + "\n... (truncated)"
          : bioContent;
        const bioLongest = (truncated.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
        const bioFence = "`".repeat(Math.max(3, bioLongest + 1));
        bioSections.push(`### ${npc.displayName} (\`${uuid}\`)\n${bioFence}\n${truncated}\n${bioFence}`);
        totalLength += truncated.length;
      }
    }
  }

  // Format for the tuner LLM — section headers use the canonical relative
  // path. The LLM must echo this exact string back in any prompt_changes
  // proposal; downstream validation rejects anything that isn't an exact match.
  const sections = allFiles.map((f) => {
    const label = EDITABILITY_LABELS[f.editability];
    const maxLen = f.editability === "DO_NOT_EDIT" ? READ_ONLY_FILE_LIMIT : EDITABLE_FILE_LIMIT;
    const truncated = f.content.length > maxLen
      ? f.content.substring(0, maxLen) + "\n... (truncated)"
      : f.content;
    // Use a fence longer than any backtick run inside the content so embedded
    // ``` blocks (common in prompts that show markdown examples) don't close
    // the wrapper early and cause the LLM to see a truncated file.
    const longestRun = (truncated.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    return `### \`${f.relativePath}\`\n**[${label}]**\n${fence}\n${truncated}\n${fence}`;
  });

  if (bioSections.length > 0) {
    sections.push(`\n## Character Bios (read-only context — do not propose changes to these)\n\n${bioSections.join("\n\n")}`);
  }

  if (totalLength > MAX_TOTAL) {
    sections.push(`\n... (additional files truncated for context)`);
  }

  return { content: sections.join("\n\n"), files: allFiles };
}
