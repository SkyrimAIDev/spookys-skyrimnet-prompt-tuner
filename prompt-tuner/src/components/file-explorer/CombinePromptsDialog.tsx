"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useFileStore } from "@/stores/fileStore";
import { useAppStore } from "@/stores/appStore";
import { Loader2, ArrowUp, ArrowDown, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";

interface Conflict {
  relativePath: string;
  existsIn: string[];
}

interface CombinePromptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CombinePromptsDialog({ open, onOpenChange }: CombinePromptsDialogProps) {
  const [sets, setSets] = useState<string[]>([]);
  const [selectedSets, setSelectedSets] = useState<string[]>([]);
  const [targetName, setTargetName] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [showConflictDetails, setShowConflictDetails] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [combining, setCombining] = useState(false);
  const [step, setStep] = useState<"select" | "conflicts" | "name">("select");

  // Fetch available sets on open
  useEffect(() => {
    if (!open) return;
    setSelectedSets([]);
    setConflicts(null);
    setResolutions({});
    setShowConflictDetails(false);
    setTargetName("");
    setStep("select");
    fetch("/api/export/list-sets")
      .then((r) => r.json())
      .then((data) => setSets(data.sets || []))
      .catch(() => {});
  }, [open]);

  const toggleSet = (name: string) => {
    setSelectedSets((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    );
    setConflicts(null); // Reset conflicts when selection changes
  };

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    setSelectedSets((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    setSelectedSets((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const handleDetectConflicts = useCallback(async () => {
    if (selectedSets.length < 2) return;
    setDetecting(true);
    try {
      const resp = await fetch("/api/export/detect-conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setNames: selectedSets }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.error || "Failed to detect conflicts");
        return;
      }
      setConflicts(data.conflicts);
      // Default resolutions: highest priority set wins (last in selectedSets)
      const defaults: Record<string, string> = {};
      for (const c of data.conflicts) {
        // Find the highest priority set that has this file
        for (let i = selectedSets.length - 1; i >= 0; i--) {
          if (c.existsIn.includes(selectedSets[i])) {
            defaults[c.relativePath] = selectedSets[i];
            break;
          }
        }
      }
      setResolutions(defaults);
      setStep("name"); // Go straight to name — conflicts shown as optional review
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    } finally {
      setDetecting(false);
    }
  }, [selectedSets]);

  const handleCombine = useCallback(async () => {
    if (!targetName.trim() || selectedSets.length < 2) return;
    setCombining(true);
    try {
      const sources = selectedSets.map((name, idx) => ({ setName: name, priority: idx + 1 }));
      const resp = await fetch("/api/export/combine-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetName: targetName.trim(),
          sources,
          conflictResolutions: resolutions,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.error || "Failed to combine sets");
        return;
      }
      toast.success(`Combined ${data.filesCopied} files into "${data.name}"${data.conflictsResolved > 0 ? ` (${data.conflictsResolved} conflicts resolved)` : ""}`);
      useFileStore.getState().refreshTree();
      useAppStore.getState().bumpPromptSetList();
      onOpenChange(false);
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    } finally {
      setCombining(false);
    }
  }, [targetName, selectedSets, resolutions, onOpenChange]);

  const shortName = (name: string) => name === "__original__" ? "Original Prompts" : name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[550px] sm:max-w-[550px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Combine Prompt Sets</DialogTitle>
        </DialogHeader>

        {/* Step 1: Select Sets */}
        {step === "select" && (
          <div className="space-y-3 flex-1 min-h-0">
            <div className="text-[10px] text-muted-foreground">
              Select sets to combine. Order determines priority — sets lower in the list overwrite files from sets above.
            </div>

            {/* Available sets */}
            <div className="max-h-48 overflow-y-auto space-y-0.5 border rounded p-1">
              {/* Original prompts option */}
              <label className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs transition-colors ${
                selectedSets.includes("__original__") ? "bg-primary/10" : "hover:bg-accent/50"
              }`}>
                <input
                  type="checkbox"
                  checked={selectedSets.includes("__original__")}
                  onChange={() => toggleSet("__original__")}
                  className="h-3 w-3"
                />
                <span className="font-medium">Original Prompts</span>
              </label>
              {sets.map((name) => (
                <label key={name} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs transition-colors ${
                  selectedSets.includes(name) ? "bg-primary/10" : "hover:bg-accent/50"
                }`}>
                  <input
                    type="checkbox"
                    checked={selectedSets.includes(name)}
                    onChange={() => toggleSet(name)}
                    className="h-3 w-3"
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>

            {/* Priority order */}
            {selectedSets.length >= 2 && (
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground font-medium">
                  Priority Order (bottom wins conflicts):
                </div>
                <div className="border rounded p-1 space-y-0.5">
                  {selectedSets.map((name, idx) => (
                    <div key={name} className="flex items-center gap-1.5 px-2 py-1 text-xs bg-muted/30 rounded">
                      <span className="text-[9px] text-muted-foreground w-4 shrink-0">{idx + 1}.</span>
                      <span className="flex-1 truncate">{shortName(name)}</span>
                      <button onClick={() => moveUp(idx)} disabled={idx === 0} className="p-0.5 rounded hover:bg-accent disabled:opacity-30">
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button onClick={() => moveDown(idx)} disabled={idx === selectedSets.length - 1} className="p-0.5 rounded hover:bg-accent disabled:opacity-30">
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Name + optional conflict overrides */}
        {step === "name" && (
          <div className="space-y-3 flex-1 min-h-0 overflow-hidden">
            <div className="space-y-2">
              <div className="text-[10px] text-muted-foreground font-medium">New set name:</div>
              <Input
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="Combined_Prompts"
                className="h-7 text-xs"
                onKeyDown={(e) => { if (e.key === "Enter" && targetName.trim()) handleCombine(); }}
              />
            </div>

            {/* Conflict summary + optional override */}
            {conflicts && conflicts.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""} {showConflictDetails ? "— manually resolving" : "will be resolved by priority"}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  onClick={() => setShowConflictDetails((v) => !v)}
                >
                  {showConflictDetails ? "Hide Conflicts" : "Manually Resolve Conflicts"}
                </Button>

                {showConflictDetails && (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 border rounded p-2">
                    {conflicts.map((c) => (
                      <div key={c.relativePath} className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{c.relativePath}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 pl-4">
                          {c.existsIn.map((setName) => (
                            <button
                              key={setName}
                              onClick={() => setResolutions((prev) => ({ ...prev, [c.relativePath]: setName }))}
                              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                                resolutions[c.relativePath] === setName
                                  ? "bg-primary/20 border-primary/40 text-primary"
                                  : "hover:bg-accent/50 border-transparent"
                              }`}
                            >
                              {shortName(setName)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {conflicts && conflicts.length === 0 && (
              <div className="text-[10px] text-green-400">No conflicts detected — all files are unique across sets.</div>
            )}
          </div>
        )}

        <DialogFooter className="gap-1">
          {step === "select" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleDetectConflicts}
                disabled={selectedSets.length < 2 || detecting}
              >
                {detecting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Next
              </Button>
            </>
          )}
          {step === "name" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setStep("select")}>
                Back
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleCombine}
                disabled={!targetName.trim() || combining}
              >
                {combining ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Combine
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
