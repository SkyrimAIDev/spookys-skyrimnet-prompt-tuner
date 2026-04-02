"use client";

import React, { useState } from "react";
import { Maximize2 } from "lucide-react";
import { ExpandContentModal } from "./ExpandContentModal";

interface SettingsChange { parameter: string; oldValue: unknown; newValue: unknown; reason: string }
interface PromptChange { filePath: string; searchText: string; replaceText: string; reason: string }

/**
 * Renders structured change markers (__SETTINGS_TABLE__, __PROMPT_DIFF__)
 * as formatted tables and diff boxes within chat messages.
 */
export function ChatChangeDisplay({ content }: { content: string }) {
  const parts = content.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("__SETTINGS_TABLE__")) {
      try {
        const changes = JSON.parse(part.slice("__SETTINGS_TABLE__".length)) as SettingsChange[];
        elements.push(
          <div key={`settings-${i}`} className="rounded border overflow-hidden my-1">
            <table className="w-full text-[10px] table-fixed">
              <thead><tr className="bg-muted/50">
                <th className="text-left px-2 py-0.5 font-medium w-[90px]">Parameter</th>
                <th className="text-left px-2 py-0.5 font-medium w-[45px]">Old</th>
                <th className="text-left px-2 py-0.5 font-medium w-[45px]">New</th>
                <th className="text-left px-2 py-0.5 font-medium">Reason</th>
              </tr></thead>
              <tbody>{changes.map((c, j) => (
                <tr key={j} className="border-t">
                  <td className="px-2 py-0.5 font-mono">{c.parameter}</td>
                  <td className="px-2 py-0.5 text-red-400 font-mono">{JSON.stringify(c.oldValue)}</td>
                  <td className="px-2 py-0.5 text-green-400 font-mono">{JSON.stringify(c.newValue)}</td>
                  <td className="px-2 py-0.5 text-muted-foreground break-words">{c.reason}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        );
      } catch { elements.push(<div key={`s-err-${i}`}>{part}</div>); }
    } else if (part.startsWith("__PROMPT_DIFF__")) {
      try {
        const changes = JSON.parse(part.slice("__PROMPT_DIFF__".length)) as PromptChange[];
        for (const [j, pc] of changes.entries()) {
          elements.push(
            <div key={`prompt-${i}-${j}`} className="rounded border p-2 space-y-1 my-1 min-w-0 overflow-hidden">
              <div className="text-[10px] font-mono text-muted-foreground truncate">{pc.filePath.replace(/\\/g, "/").split("/").slice(-2).join("/")}</div>
              <div className="text-[10px] text-muted-foreground break-words">{pc.reason}</div>
              {pc.searchText && (
                <div className="grid grid-cols-2 gap-1 text-[10px] min-w-0">
                  <ExpandableDiffBox content={pc.searchText} variant="removed" title={`${pc.filePath.replace(/\\/g, "/").split("/").pop()} — Before`} />
                  <ExpandableDiffBox content={pc.replaceText} variant="added" title={`${pc.filePath.replace(/\\/g, "/").split("/").pop()} — After`} />
                </div>
              )}
              {!pc.searchText && pc.replaceText && (
                <ExpandableDiffBox content={pc.replaceText} variant="added" title={`${pc.filePath.replace(/\\/g, "/").split("/").pop()} — New content`} maxPreview={300} />
              )}
            </div>
          );
        }
      } catch { elements.push(<div key={`p-err-${i}`}>{part}</div>); }
    } else if (part.trim()) {
      elements.push(<div key={`text-${i}`} className="whitespace-pre-wrap">{part}</div>);
    }
  }

  return <>{elements}</>;
}

/** Check if a message content string contains structured change markers */
export function hasStructuredChanges(content: string): boolean {
  return content.includes("__SETTINGS_TABLE__") || content.includes("__PROMPT_DIFF__");
}

/** Diff box with expand button for viewing full content in a modal */
export function ExpandableDiffBox({ content, variant, title, maxPreview }: {
  content: string;
  variant: "added" | "removed";
  title: string;
  maxPreview?: number;
}) {
  const [expandOpen, setExpandOpen] = useState(false);
  const bg = variant === "removed" ? "bg-red-500/10" : "bg-green-500/10";
  const preview = maxPreview && content.length > maxPreview
    ? content.substring(0, maxPreview) + "..."
    : content;

  return (
    <>
      <div className={`relative group/diff ${bg} rounded p-1.5 font-mono whitespace-pre-wrap max-h-24 overflow-auto break-all min-w-0 text-[10px]`}>
        {preview}
        <button
          onClick={() => setExpandOpen(true)}
          className="absolute top-1 right-1 p-0.5 rounded bg-background/80 opacity-0 group-hover/diff:opacity-100 transition-opacity hover:bg-background"
          title="Expand"
        >
          <Maximize2 className="h-2.5 w-2.5" />
        </button>
      </div>
      <ExpandContentModal open={expandOpen} onOpenChange={setExpandOpen} title={title} content={content} />
    </>
  );
}
