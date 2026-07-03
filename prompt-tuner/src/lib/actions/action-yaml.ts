import type { CustomActionYaml } from "@/types/yaml-configs";
import type { ActionDefinition } from "@/types/actions";

/**
 * Bridge between the two custom-action representations:
 *  - `ActionDefinition` — the in-app registry (drives the tool's prompts)
 *  - `CustomActionYaml`  — config/actions/*.yaml on disk (ships in the export)
 *
 * Registry actions loaded from disk get a `yaml-` id prefix so they can be told
 * apart from registry-native customs (see persistActions / loadActions in the
 * simulation store).
 */

export const YAML_ACTION_ID_PREFIX = "yaml-";

/** A config/actions YAML action → a registry ActionDefinition. */
export function customActionYamlToDefinition(y: CustomActionYaml): ActionDefinition {
  const hasSchema = y.parameterSchema && Object.keys(y.parameterSchema).length > 0;
  return {
    id: `${YAML_ACTION_ID_PREFIX}${y.name}`,
    name: y.name,
    description: y.description,
    parameterSchema: hasSchema ? JSON.stringify(y.parameterSchema) : undefined,
    category: "custom",
    enabled: true,
  };
}

/** A registry ActionDefinition → a config/actions YAML shape (for export). */
export function actionDefinitionToYaml(d: ActionDefinition): CustomActionYaml {
  let parameterSchema: Record<string, string> | undefined;
  if (d.parameterSchema) {
    try {
      const parsed = JSON.parse(d.parameterSchema);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parameterSchema = parsed as Record<string, string>;
      }
    } catch {
      // Not JSON — omit the schema rather than emit something invalid.
    }
  }
  return {
    name: d.name,
    description: d.description,
    ...(parameterSchema ? { parameterSchema } : {}),
    category: "custom",
  };
}

/**
 * Merge disk YAML actions into a registry, adding any whose name isn't already
 * present (case-insensitive). Registry-native actions of the same name win, so a
 * user's in-app edit shadows the on-disk copy rather than duplicating it.
 */
export function mergeYamlActions(
  registry: ActionDefinition[],
  yamlActions: CustomActionYaml[],
): ActionDefinition[] {
  const takenNames = new Set(registry.map((a) => a.name.toLowerCase()));
  const additions: ActionDefinition[] = [];
  for (const y of yamlActions) {
    const key = y.name.toLowerCase();
    if (takenNames.has(key)) continue;
    takenNames.add(key);
    additions.push(customActionYamlToDefinition(y));
  }
  return additions.length ? [...registry, ...additions] : registry;
}
