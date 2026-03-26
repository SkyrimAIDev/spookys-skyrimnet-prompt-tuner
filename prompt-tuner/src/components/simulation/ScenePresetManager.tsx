"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScenePresetStore } from "@/stores/scenePresetStore";
import { useSimulationStore } from "@/stores/simulationStore";
import type { ScenePreset } from "@/types/simulation";
import { resolveNpcsIfNeeded } from "@/lib/npc/resolve-npc";
import { exportScenePreset, parsePresetFile } from "@/lib/simulation/scene-preset-io";
import { Copy, Save, Trash2, Lock, Download, Upload } from "lucide-react";
import { toast } from "sonner";

async function applyPresetToSimulation(preset: ScenePreset) {
  const simStore = useSimulationStore.getState();
  simStore.setScene(preset.scene);
  simStore.selectedNpcs.forEach((n) => simStore.removeNpc(n.uuid));
  const resolvedNpcs = await resolveNpcsIfNeeded(preset.npcs);
  resolvedNpcs.forEach((n) => simStore.addNpc(n));
  if (preset.actionStates) {
    for (const action of simStore.actionRegistry) {
      const savedState = preset.actionStates[action.id];
      if (savedState !== undefined && savedState !== action.enabled) {
        simStore.toggleAction(action.id);
      }
    }
  }
  if (preset.player) {
    simStore.setPlayerConfig(preset.player);
  }
}

// Track globally so re-mounts (tab switches) don't re-apply the preset
let globalInitialApplied = false;

export function ScenePresetManager() {
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const presets = useScenePresetStore((s) => s.presets);
  const activePresetId = useScenePresetStore((s) => s.activePresetId);
  const setActivePresetId = useScenePresetStore((s) => s.setActivePresetId);
  const addPreset = useScenePresetStore((s) => s.addPreset);
  const deletePreset = useScenePresetStore((s) => s.deletePreset);
  const getPreset = useScenePresetStore((s) => s.getPreset);
  const load = useScenePresetStore((s) => s.load);

  const scene = useSimulationStore((s) => s.scene);
  const selectedNpcs = useSimulationStore((s) => s.selectedNpcs);
  const actionRegistry = useSimulationStore((s) => s.actionRegistry);
  const playerConfig = useSimulationStore((s) => s.playerConfig);
  const setScene = useSimulationStore((s) => s.setScene);
  const setPlayerConfig = useSimulationStore((s) => s.setPlayerConfig);
  const toggleAction = useSimulationStore((s) => s.toggleAction);

  const activePreset = presets.find((p) => p.id === activePresetId);
  const isDefaultActive = !!activePreset?.isDefault;

  // Load presets on mount
  useEffect(() => {
    load();
  }, [load]);

  // Auto-apply active preset on initial page load only (not on tab switches)
  useEffect(() => {
    if (globalInitialApplied || presets.length === 0 || !activePresetId) return;
    const preset = getPreset(activePresetId);
    if (!preset) return;
    applyPresetToSimulation(preset);
    globalInitialApplied = true;
  }, [presets, activePresetId, getPreset]);

  const handleShowSave = () => {
    // Pre-fill copy name when saving from the default preset
    if (isDefaultActive && activePreset) {
      setSaveName(`${activePreset.name.replace(" (Default)", "")} (Copy)`);
    }
    setShowSave(true);
  };

  const handleSave = () => {
    const name = saveName.trim();
    if (!name) {
      toast.error("Preset name is required");
      return;
    }
    addPreset(name, scene, selectedNpcs, actionRegistry, playerConfig);
    toast.success(`Scene preset "${name}" saved`);
    setSaveName("");
    setShowSave(false);
  };

  const handleSelect = (id: string) => {
    if (!id || id === activePresetId) return;
    const preset = getPreset(id);
    if (!preset) return;
    setActivePresetId(id);
    applyPresetToSimulation(preset);
    toast.success(`Scene preset "${preset.name}" loaded`);
  };

  const handleDuplicate = () => {
    const preset = getPreset(activePresetId);
    if (!preset) return;
    const newPreset = addPreset(
      `${preset.name} (Copy)`,
      preset.scene,
      preset.npcs.map((n) => ({ ...n })),
      actionRegistry,
      preset.player,
    );
    applyPresetToSimulation(newPreset);
    toast.success(`Duplicated as "${newPreset.name}"`);
  };

  const handleDelete = () => {
    if (presets.length <= 1) {
      toast.error("Cannot delete the last preset");
      return;
    }
    const preset = getPreset(activePresetId);
    if (!preset) return;
    deletePreset(activePresetId);

    // Load the new active preset
    const newState = useScenePresetStore.getState();
    const newPreset = newState.getPreset(newState.activePresetId);
    if (newPreset) {
      applyPresetToSimulation(newPreset);
    }
    toast.success(`Scene preset "${preset.name}" deleted`);
  };

  const handleExport = () => {
    const preset = getPreset(activePresetId);
    if (!preset) return;
    exportScenePreset(preset);
    toast.success(`Exported "${preset.name}"`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const result = await parsePresetFile(file);
    if (!result.valid) {
      toast.error("Import failed", { description: result.error });
      return;
    }

    for (const preset of result.presets) {
      addPreset(preset.name, preset.scene, preset.npcs, actionRegistry, preset.player);
    }

    // Apply the last imported preset
    const newState = useScenePresetStore.getState();
    const latest = newState.getPreset(newState.activePresetId);
    if (latest) applyPresetToSimulation(latest);

    toast.success(`Imported ${result.presets.length} preset${result.presets.length !== 1 ? "s" : ""}`);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <select
          value={activePresetId}
          onChange={(e) => handleSelect(e.target.value)}
          className="h-6 flex-1 rounded-md border bg-background text-foreground px-1.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-ring [&>option]:bg-background [&>option]:text-foreground"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {isDefaultActive && (
          <span title="Built-in preset — read only">
            <Lock className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleDuplicate}
          title="Duplicate preset"
        >
          <Copy className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleExport}
          title="Export preset to file"
        >
          <Download className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => importRef.current?.click()}
          title="Import preset from file"
        >
          <Upload className="h-3 w-3" />
        </Button>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImport}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
          onClick={handleDelete}
          disabled={presets.length <= 1 || isDefaultActive}
          title={isDefaultActive ? "Built-in preset cannot be deleted" : "Delete preset"}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {showSave ? (
        <div className="flex items-center gap-1">
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Preset name..."
            className="h-6 text-[10px] flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") {
                setShowSave(false);
                setSaveName("");
              }
            }}
            autoFocus
          />
          <Button
            size="sm"
            className="h-6 text-[9px] px-2"
            onClick={handleSave}
            disabled={!saveName.trim()}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[9px] px-2"
            onClick={() => {
              setShowSave(false);
              setSaveName("");
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[9px] w-full"
          onClick={handleShowSave}
        >
          <Save className="h-3 w-3 mr-1" />
          {isDefaultActive ? "Save as New Preset (Copy)" : "Save Scene as New Preset"}
        </Button>
      )}
    </div>
  );
}
