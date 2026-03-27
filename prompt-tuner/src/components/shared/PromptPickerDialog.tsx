"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AGENT_PROMPT_PATHS } from "@/lib/autotuner/fetch-prompt-content";
import { RECOMMENDED_PROMPTS } from "@/lib/autotuner/prompt-editing-modes";
import { getCategoryDef } from "@/lib/benchmark/categories";
import type { BenchmarkCategory } from "@/types/benchmark";
import { Loader2, FileText, FolderOpen, Star } from "lucide-react";

interface PromptFileEntry {
  /** Relative path from prompt set base, e.g. "submodules/guidelines/0500_roleplay_guidelines.prompt" */
  relativePath: string;
  /** Display name, e.g. "0500_roleplay_guidelines.prompt" */
  name: string;
  /** Parent directory label, e.g. "submodules/guidelines" */
  group: string;
}

interface PromptPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: BenchmarkCategory;
  promptSetName: string;
  selectedPaths: string[];
  onConfirm: (paths: string[]) => void;
}

export function PromptPickerDialog({
  open,
  onOpenChange,
  category,
  promptSetName,
  selectedPaths,
  onConfirm,
}: PromptPickerDialogProps) {
  const [files, setFiles] = useState<PromptFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedPaths));

  const recommendedSet = useMemo(
    () => new Set(RECOMMENDED_PROMPTS[category] || []),
    [category],
  );

  // Reset selection when dialog opens
  useEffect(() => {
    if (open) {
      setSelected(new Set(selectedPaths));
    }
  }, [open, selectedPaths]);

  // Fetch prompt files when dialog opens
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const catDef = getCategoryDef(category);
      const agent = catDef?.agent || "default";
      const agentPaths = AGENT_PROMPT_PATHS[agent] || [];

      // Resolve the prompt set base path
      const resolveResp = await fetch(
        `/api/files/resolve-prompt-set?name=${encodeURIComponent(promptSetName)}`
      );
      if (!resolveResp.ok) {
        setFiles([]);
        return;
      }
      const { basePath } = await resolveResp.json();

      // Also resolve the originals base path as fallback
      let originalsBasePath: string | null = null;
      if (promptSetName) {
        try {
          const originalsResp = await fetch(`/api/files/resolve-prompt-set?name=`);
          if (originalsResp.ok) {
            const data = await originalsResp.json();
            originalsBasePath = data.basePath;
          }
        } catch { /* skip */ }
      }

      const entries: PromptFileEntry[] = [];

      for (const entry of agentPaths) {
        const fullPath = `${basePath}/${entry}`.replace(/\\/g, "/");
        const originalsPath = originalsBasePath
          ? `${originalsBasePath}/${entry}`.replace(/\\/g, "/")
          : null;

        if (entry.endsWith(".prompt")) {
          // Individual file
          const name = entry.split("/").pop() || entry;
          const group = entry.includes("/") ? entry.substring(0, entry.lastIndexOf("/")) : "(root)";
          entries.push({ relativePath: entry, name, group });
        } else {
          // Directory — list from active set, then merge missing files from originals
          const seenNames = new Set<string>();

          // List from active set first
          try {
            const resp = await fetch(
              `/api/files/children?path=${encodeURIComponent(fullPath)}&limit=50`
            );
            if (resp.ok) {
              const data = await resp.json();
              const children = (data.children || data.nodes || []) as { name: string; type: string }[];
              for (const child of children) {
                if (child.type !== "file" || !child.name.endsWith(".prompt")) continue;
                seenNames.add(child.name);
                entries.push({ relativePath: `${entry}/${child.name}`, name: child.name, group: entry });
              }
            }
          } catch { /* skip */ }

          // Fill in from originals for any files not in the active set
          if (originalsPath) {
            try {
              const resp = await fetch(
                `/api/files/children?path=${encodeURIComponent(originalsPath)}&limit=50`
              );
              if (resp.ok) {
                const data = await resp.json();
                const children = (data.children || data.nodes || []) as { name: string; type: string }[];
                for (const child of children) {
                  if (child.type !== "file" || !child.name.endsWith(".prompt")) continue;
                  if (seenNames.has(child.name)) continue;
                  entries.push({ relativePath: `${entry}/${child.name}`, name: child.name, group: entry });
                }
              }
            } catch { /* skip */ }
          }
        }
      }

      // Sort: recommended first, then by group and name
      const rec = RECOMMENDED_PROMPTS[category] || [];
      const recSet = new Set(rec);
      entries.sort((a, b) => {
        const aRec = recSet.has(a.relativePath) ? 0 : 1;
        const bRec = recSet.has(b.relativePath) ? 0 : 1;
        if (aRec !== bRec) return aRec - bRec;
        if (a.group !== b.group) return a.group.localeCompare(b.group);
        return a.name.localeCompare(b.name);
      });

      setFiles(entries);
    } catch (err) {
      console.error("Failed to fetch prompt files:", err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [category, promptSetName]);

  useEffect(() => {
    if (open) fetchFiles();
  }, [open, fetchFiles]);

  const toggleFile = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const selectRecommended = () => {
    setSelected(new Set(recommendedSet));
  };

  const selectAll = () => {
    setSelected(new Set(files.map((f) => f.relativePath)));
  };

  const clearAll = () => setSelected(new Set());

  const handleConfirm = () => {
    onConfirm([...selected]);
    onOpenChange(false);
  };

  // Group files by directory
  const groups = new Map<string, PromptFileEntry[]>();
  for (const f of files) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group)!.push(f);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] sm:max-w-[500px] max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Select Prompt Files</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : files.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No prompt files found for this agent.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground px-1">
              <button onClick={selectRecommended} className="hover:text-foreground transition-colors underline">
                Select recommended
              </button>
              <span>|</span>
              <button onClick={selectAll} className="hover:text-foreground transition-colors underline">
                Select all
              </button>
              <span>|</span>
              <button onClick={clearAll} className="hover:text-foreground transition-colors underline">
                Clear all
              </button>
              <span className="ml-auto">{selected.size} selected</span>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
              {[...groups.entries()].map(([group, groupFiles]) => (
                <div key={group}>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium mb-1 px-1">
                    <FolderOpen className="h-3 w-3" />
                    {group}
                  </div>
                  <div className="space-y-0.5">
                    {groupFiles.map((f) => {
                      const isSelected = selected.has(f.relativePath);
                      const isRecommended = recommendedSet.has(f.relativePath);
                      return (
                        <button
                          key={f.relativePath}
                          onClick={() => toggleFile(f.relativePath)}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition-colors ${
                            isSelected
                              ? "bg-primary/10 border border-primary/30"
                              : "hover:bg-accent/50 border border-transparent"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            className="h-3 w-3 rounded border-muted-foreground shrink-0 pointer-events-none"
                          />
                          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate flex-1">{f.name}</span>
                          {isRecommended && (
                            <span className="flex items-center gap-0.5 text-[9px] text-amber-400 shrink-0">
                              <Star className="h-2.5 w-2.5 fill-amber-400" />
                              Recommended
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleConfirm}
            disabled={selected.size === 0}
          >
            Confirm ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
