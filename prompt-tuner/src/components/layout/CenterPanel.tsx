"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppStore } from "@/stores/appStore";
import { EditorPanel } from "@/components/editor/EditorPanel";
import { PreviewChat } from "@/components/chat/PreviewChat";
import { TunerChat } from "@/components/chat/TunerChat";
import { BenchmarkCenter } from "@/components/benchmark/BenchmarkCenter";
import { AutoTunerCenter } from "@/components/autotuner/AutoTunerCenter";
import { CopycatCenter } from "@/components/copycat/CopycatCenter";
import { Code, MessageSquare, Eye, BarChart3, Wand2, Layers } from "lucide-react";

export function CenterPanel() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <div className="flex h-full flex-col min-w-0">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
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
    </div>
  );
}
