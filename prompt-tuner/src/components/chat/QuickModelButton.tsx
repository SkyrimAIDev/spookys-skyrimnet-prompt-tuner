"use client";

import { useSimulationStore } from "@/stores/simulationStore";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Cpu, X } from "lucide-react";
import { QuickModelInput } from "@/components/shared/QuickModelInput";
import { addToModelHistory } from "@/lib/utils/model-history";

export function QuickModelButton() {
  const quickDialogueModel = useSimulationStore((s) => s.quickDialogueModel);
  const setQuickDialogueModel = useSimulationStore((s) => s.setQuickDialogueModel);

  const isActive = !!quickDialogueModel;

  const handleAdd = (model: string) => {
    addToModelHistory(model);
    setQuickDialogueModel(model);
  };

  const handleClear = () => {
    setQuickDialogueModel("");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-colors ${
            isActive
              ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
          title={isActive ? `Quick model: ${quickDialogueModel}` : "Set a quick dialogue model"}
        >
          <Cpu className="h-3.5 w-3.5" />
          {isActive ? (
            <span className="max-w-[100px] truncate font-mono">{quickDialogueModel.split("/").pop()}</span>
          ) : (
            "Model"
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-64 p-0"
        sideOffset={8}
      >
        <div className="p-3 space-y-2">
          <div className="text-xs font-semibold">Quick Dialogue Model</div>
          <div className="text-[10px] text-muted-foreground leading-relaxed">
            Override the dialogue model for this session. Uses the active profile&apos;s API settings.
          </div>

          {isActive && (
            <div className="flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1.5">
              <span className="text-[10px] font-mono truncate flex-1 min-w-0 text-amber-300">{quickDialogueModel}</span>
              <button
                onClick={handleClear}
                className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="Clear override"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <QuickModelInput
            onAdd={handleAdd}
            placeholder={isActive ? "Change model..." : "Type model name..."}
          />

          {isActive && (
            <div className="text-[9px] text-amber-400/60">
              Active — overriding profile&apos;s dialogue model
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
