"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppStore } from "@/stores/appStore";
import { useFileStore } from "@/stores/fileStore";
import { EditorPanel } from "@/components/editor/EditorPanel";
import { PreviewChat } from "@/components/chat/PreviewChat";
import { TunerChat } from "@/components/chat/TunerChat";
import { BenchmarkCenter } from "@/components/benchmark/BenchmarkCenter";
import { AutoTunerCenter } from "@/components/autotuner/AutoTunerCenter";
import { CopycatCenter } from "@/components/copycat/CopycatCenter";
import { Code, MessageSquare, Eye, BarChart3, Wand2, Layers } from "lucide-react";
import { toast } from "sonner";

async function saveAllDirty(): Promise<boolean> {
  const { openFiles, markFileSaved, refreshTree } = useFileStore.getState();
  const dirty = openFiles.filter((f) => f.isDirty && !f.isReadOnly);
  for (const file of dirty) {
    try {
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: file.path, content: file.content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(`Save failed for ${file.displayName || file.name}: ${data.error || res.status}`);
        return false;
      }
      markFileSaved(file.path);
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
      return false;
    }
  }
  if (dirty.length > 0) refreshTree();
  return true;
}

export function CenterPanel() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  // Whenever the active tab actually changes, drop any pending dialog state.
  useEffect(() => {
    setPendingTab(null);
  }, [activeTab]);

  // Warn the user if they try to close the window with unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const hasDirty = useFileStore.getState().openFiles.some((f) => f.isDirty && !f.isReadOnly);
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const handleTabChange = (v: string) => {
    if (v === activeTab) return;
    const hasDirty = useFileStore.getState().openFiles.some((f) => f.isDirty && !f.isReadOnly);
    const fromEditing = activeTab === "editor" || activeTab === "tuner";
    const toEditing = v === "editor" || v === "tuner";
    if (hasDirty && fromEditing && !toEditing) {
      setPendingTab(v);
      return;
    }
    setActiveTab(v as typeof activeTab);
  };

  const confirmSaveAndSwitch = async () => {
    if (!pendingTab) return;
    const ok = await saveAllDirty();
    if (ok) {
      setActiveTab(pendingTab as typeof activeTab);
      setPendingTab(null);
    }
  };

  return (
    <div className="flex h-full flex-col min-w-0">
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex h-full flex-col min-w-0"
      >
        <div className="border-b bg-card px-2">
          <TabsList className="h-8 bg-transparent">
            <TabsTrigger value="editor" className="gap-1.5 text-xs h-7 data-[state=active]:bg-background">
              <Code className="h-3.5 w-3.5" />
              Editor
            </TabsTrigger>
            <TabsTrigger value="tuner" className="gap-1.5 text-xs h-7 data-[state=active]:bg-background">
              <MessageSquare className="h-3.5 w-3.5" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="preview" className="gap-1.5 text-xs h-7 data-[state=active]:bg-background">
              <Eye className="h-3.5 w-3.5" />
              Preview
            </TabsTrigger>
            <TabsTrigger value="benchmark" className="gap-1.5 text-xs h-7 data-[state=active]:bg-background">
              <BarChart3 className="h-3.5 w-3.5" />
              Benchmark
            </TabsTrigger>
            <TabsTrigger value="autotuner" className="gap-1.5 text-xs h-7 data-[state=active]:bg-background">
              <Wand2 className="h-3.5 w-3.5" />
              Tuner
            </TabsTrigger>
            <TabsTrigger value="copycat" className="gap-1.5 text-xs h-7 data-[state=active]:bg-background">
              <Layers className="h-3.5 w-3.5" />
              Copycat
            </TabsTrigger>
          </TabsList>
        </div>
        {/* forceMount keeps all tabs in the DOM so state survives tab switches.
            Inactive tabs are hidden via data-[state=inactive]:hidden. */}
        <TabsContent value="editor" forceMount className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <EditorPanel />
        </TabsContent>
        <TabsContent value="tuner" forceMount className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <TunerChat />
        </TabsContent>
        <TabsContent value="preview" forceMount className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <PreviewChat />
        </TabsContent>
        <TabsContent value="benchmark" forceMount className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <BenchmarkCenter />
        </TabsContent>
        <TabsContent value="autotuner" forceMount className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <AutoTunerCenter />
        </TabsContent>
        <TabsContent value="copycat" forceMount className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <CopycatCenter />
        </TabsContent>
      </Tabs>

      {pendingTab && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setPendingTab(null)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-lg border bg-card shadow-lg p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold">Unsaved Changes</div>
            <div className="text-xs text-muted-foreground">
              You have unsaved edits in the editor. They won&apos;t be used by the tuner or chat until they are saved. Save now before switching tabs?
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingTab(null)}
                className="rounded border px-3 py-1 text-xs hover:bg-accent/50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setActiveTab(pendingTab as typeof activeTab);
                  setPendingTab(null);
                }}
                className="rounded border px-3 py-1 text-xs hover:bg-accent/50"
              >
                Switch
              </button>
              <button
                onClick={confirmSaveAndSwitch}
                className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
              >
                Save & Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
