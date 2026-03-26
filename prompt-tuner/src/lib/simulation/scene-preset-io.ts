import type { ScenePreset } from "@/types/simulation";

const FORMAT_ID = "skyrimnet-scene-presets";
const FORMAT_VERSION = 1;

interface PresetExportEnvelope {
  format: string;
  version: number;
  exportedAt: string;
  presets: Omit<ScenePreset, "id" | "isDefault">[];
}

type ValidationResult =
  | { valid: true; presets: ScenePreset[] }
  | { valid: false; error: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function freshId(): string {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function stripForExport(
  preset: ScenePreset,
): Omit<ScenePreset, "id" | "isDefault"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, isDefault: _isDefault, ...rest } = preset;
  return rest;
}

function triggerDownload(json: string, filename: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Export ───────────────────────────────────────────────────────────

export function exportScenePreset(preset: ScenePreset) {
  const envelope: PresetExportEnvelope = {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    presets: [stripForExport(preset)],
  };
  const filename = `scene_${slugify(preset.name)}.json`;
  triggerDownload(JSON.stringify(envelope, null, 2), filename);
}

export function exportAllScenePresets(presets: ScenePreset[]) {
  const envelope: PresetExportEnvelope = {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    presets: presets.map(stripForExport),
  };
  triggerDownload(JSON.stringify(envelope, null, 2), "scene_presets_all.json");
}

// ── Import / validation ─────────────────────────────────────────────

export async function parsePresetFile(file: File): Promise<ValidationResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { valid: false, error: "Could not read file" };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { valid: false, error: "Invalid JSON" };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, error: "Expected a JSON object" };
  }

  const envelope = data as Record<string, unknown>;

  if (envelope.format !== FORMAT_ID) {
    return {
      valid: false,
      error: `Unrecognized format: "${String(envelope.format)}". Expected "${FORMAT_ID}".`,
    };
  }

  if (typeof envelope.version !== "number" || envelope.version > FORMAT_VERSION) {
    return {
      valid: false,
      error: `Unsupported version: ${String(envelope.version)}. This app supports up to version ${FORMAT_VERSION}.`,
    };
  }

  if (!Array.isArray(envelope.presets) || envelope.presets.length === 0) {
    return { valid: false, error: "No presets found in file" };
  }

  const results: ScenePreset[] = [];

  for (let i = 0; i < envelope.presets.length; i++) {
    const p = envelope.presets[i] as Record<string, unknown>;

    if (!p || typeof p !== "object") {
      return { valid: false, error: `Preset ${i + 1}: not a valid object` };
    }

    if (typeof p.name !== "string" || !p.name.trim()) {
      return { valid: false, error: `Preset ${i + 1}: missing or empty name` };
    }

    if (!p.scene || typeof p.scene !== "object") {
      return { valid: false, error: `Preset ${i + 1}: missing scene data` };
    }

    if (!Array.isArray(p.npcs)) {
      return { valid: false, error: `Preset ${i + 1}: missing npcs array` };
    }

    results.push({
      ...(p as unknown as Omit<ScenePreset, "id" | "isDefault">),
      id: freshId(),
      isDefault: false,
    } as ScenePreset);
  }

  return { valid: true, presets: results };
}
