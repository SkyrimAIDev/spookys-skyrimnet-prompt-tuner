import yaml from "js-yaml";
import type { ActionDefinition } from "@/types/actions";
import { BUILTIN_ACTIONS, DEFAULT_CUSTOM_ACTIONS } from "@/lib/actions/registry";
import { actionDefinitionToYaml, YAML_ACTION_ID_PREFIX } from "@/lib/actions/action-yaml";

export interface ExportFile {
  path?: string;
  skyrimPath: string;
  content: string;
  isNew?: boolean;
}

const CONFIG_ACTIONS_DIR = "SKSE/Plugins/SkyrimNet/config/actions";

// Ids of everything seeded into the registry in code (built-ins + tool defaults).
// Only genuinely user-created custom actions are exported — never these.
const SEEDED_IDS = new Set(
  [...BUILTIN_ACTIONS, ...DEFAULT_CUSTOM_ACTIONS].map((a) => a.id),
);

/** Action names already covered by config/actions/*.yaml files in the manifest. */
function existingActionNames(files: ExportFile[]): Set<string> {
  const names = new Set<string>();
  for (const f of files) {
    if (!f.skyrimPath.replace(/\\/g, "/").includes("/config/actions/")) continue;
    try {
      const parsed = yaml.load(f.content);
      if (parsed && typeof parsed === "object" && "name" in parsed) {
        const name = (parsed as { name?: unknown }).name;
        if (typeof name === "string") names.add(name.toLowerCase());
      }
    } catch {
      // ignore unparseable disk file
    }
  }
  return names;
}

/**
 * Append the user's registry-native custom actions to the export as
 * config/actions/*.yaml, so what was tuned in the tool actually ships in the mod.
 *
 * Excludes built-ins and seeded defaults (never exported), disk-sourced actions
 * (yaml- prefix — already in the manifest), and any name already present on disk
 * (the disk copy wins). Returns the same array reference when nothing is added.
 */
export function appendCustomActionFiles(
  files: ExportFile[],
  registry: ActionDefinition[],
): ExportFile[] {
  const onDisk = existingActionNames(files);
  const additions: ExportFile[] = [];
  const usedFileNames = new Set<string>();

  for (const action of registry) {
    if (action.category !== "custom") continue;
    if (action.id.startsWith(YAML_ACTION_ID_PREFIX)) continue; // already on disk
    if (SEEDED_IDS.has(action.id)) continue; // built-in/default, not user-made
    if (onDisk.has(action.name.toLowerCase())) continue; // disk copy wins

    let fileName = action.name.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase() || "action";
    // Avoid clobbering within this batch (two names sanitizing the same).
    let n = fileName;
    let i = 2;
    while (usedFileNames.has(n)) n = `${fileName}_${i++}`;
    fileName = n;
    usedFileNames.add(fileName);

    const skyrimPath = `${CONFIG_ACTIONS_DIR}/${fileName}.yaml`;
    additions.push({
      path: skyrimPath,
      skyrimPath,
      content: yaml.dump(actionDefinitionToYaml(action)),
      isNew: true,
    });
  }

  return additions.length ? [...files, ...additions] : files;
}
