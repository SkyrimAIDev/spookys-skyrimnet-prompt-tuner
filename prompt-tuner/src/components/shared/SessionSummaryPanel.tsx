"use client";

import type { TunerProposal } from "@/types/autotuner";
import type { AiTuningSettings } from "@/types/config";
import { CheckCircle2, Loader2 } from "lucide-react";

interface SummaryRound {
  roundNumber: number;
  proposal: TunerProposal | null;
}

interface SessionSummaryPanelProps {
  summaryText: string;
  summaryStream: string;
  rounds: SummaryRound[];
  originalSettings: AiTuningSettings | null;
  finalSettings: AiTuningSettings | null;
}

export function SessionSummaryPanel({
  summaryText,
  summaryStream,
  rounds,
  originalSettings,
  finalSettings,
}: SessionSummaryPanelProps) {
  const text = summaryText || summaryStream;
  const isStreaming = !summaryText && !!summaryStream;

  // Final settings diff
  const settingsDiff: { key: string; oldVal: string; newVal: string }[] = [];
  if (originalSettings && finalSettings) {
    for (const [k, v] of Object.entries(finalSettings)) {
      const orig = originalSettings[k as keyof AiTuningSettings];
      if (JSON.stringify(v) !== JSON.stringify(orig)) {
        settingsDiff.push({ key: k, oldVal: JSON.stringify(orig), newVal: JSON.stringify(v) });
      }
    }
  }

  // Rounds that had changes
  const roundsWithChanges = rounds.filter((r) => {
    const sc = r.proposal?.settingsChanges?.length || 0;
    const pc = r.proposal?.promptChanges?.filter((c) => !c.reason?.startsWith("[SKIPPED]")).length || 0;
    return sc > 0 || pc > 0;
  });

  // Parse the narrative into sections
  const sections = parseSections(text);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border-b">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        <span className="text-xs font-medium text-emerald-400">Session Summary</span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {rounds.length} round{rounds.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Per-Round Changes */}
        {roundsWithChanges.length > 0 && (
          <div className="space-y-3">
            {roundsWithChanges.map((r) => {
              const settingsChanges = r.proposal?.settingsChanges || [];
              const promptChanges = (r.proposal?.promptChanges || []).filter(
                (c) => !c.reason?.startsWith("[SKIPPED]")
              );
              return (
                <div key={r.roundNumber} className="space-y-1.5">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Round {r.roundNumber}
                  </div>

                  {/* Settings changes for this round */}
                  {settingsChanges.length > 0 && (
                    <div className="rounded border overflow-hidden">
                      <table className="w-full text-xs table-fixed">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="text-left px-2 py-1 font-medium w-[100px]">Parameter</th>
                            <th className="text-left px-2 py-1 font-medium w-[50px]">Old</th>
                            <th className="text-left px-2 py-1 font-medium w-[50px]">New</th>
                            <th className="text-left px-2 py-1 font-medium">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {settingsChanges.map((sc, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-2 py-1 font-mono text-[10px]">{sc.parameter}</td>
                              <td className="px-2 py-1 text-red-400 font-mono text-[10px]">{JSON.stringify(sc.oldValue)}</td>
                              <td className="px-2 py-1 text-green-400 font-mono text-[10px]">{JSON.stringify(sc.newValue)}</td>
                              <td className="px-2 py-1 text-muted-foreground break-words text-[10px]">{sc.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Prompt changes for this round */}
                  {promptChanges.length > 0 && (
                    <div className="space-y-1.5">
                      {promptChanges.map((pc, i) => (
                        <div key={i} className="rounded border p-2 space-y-1 min-w-0 overflow-hidden">
                          <div className="text-[10px] font-mono text-muted-foreground truncate" title={pc.filePath}>
                            {pc.filePath.split("/").slice(-2).join("/")}
                          </div>
                          <div className="text-xs text-muted-foreground break-words">{pc.reason}</div>
                          {pc.searchText && (
                            <div className="grid grid-cols-2 gap-1 text-[10px] min-w-0">
                              <div className="bg-red-500/10 rounded p-1.5 font-mono whitespace-pre-wrap max-h-24 overflow-auto break-all min-w-0">
                                {pc.searchText}
                              </div>
                              <div className="bg-green-500/10 rounded p-1.5 font-mono whitespace-pre-wrap max-h-24 overflow-auto break-all min-w-0">
                                {pc.replaceText}
                              </div>
                            </div>
                          )}
                          {!pc.searchText && pc.replaceText && (
                            <div className="bg-green-500/10 rounded p-1.5 font-mono whitespace-pre-wrap max-h-24 overflow-auto break-all min-w-0 text-[10px]">
                              {pc.replaceText.substring(0, 300)}{pc.replaceText.length > 300 ? "..." : ""}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Final Settings — shows the cumulative result */}
        {settingsDiff.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Final Settings
            </div>
            <div className="rounded border overflow-hidden">
              <table className="w-full text-xs table-fixed">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-2 py-1 font-medium w-[120px]">Parameter</th>
                    <th className="text-left px-2 py-1 font-medium w-[60px]">Original</th>
                    <th className="text-left px-2 py-1 font-medium w-[60px]">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {settingsDiff.map((d) => (
                    <tr key={d.key} className="border-t">
                      <td className="px-2 py-1 font-mono text-[10px]">{d.key}</td>
                      <td className="px-2 py-1 text-red-400 font-mono text-[10px]">{d.oldVal}</td>
                      <td className="px-2 py-1 text-green-400 font-mono text-[10px]">{d.newVal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Narrative Analysis */}
        {sections.length > 0 ? (
          <div className="space-y-3">
            {sections.map((section, i) => (
              <div key={i}>
                {section.heading && (
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    {section.heading}
                  </div>
                )}
                <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {section.content}
                </div>
              </div>
            ))}
            {isStreaming && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
        ) : (
          <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap">
            {text}
            {isStreaming && <Loader2 className="inline h-3 w-3 animate-spin ml-1" />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Parse markdown-ish summary text into sections by headings.
 */
function parseSections(text: string): { heading: string; content: string }[] {
  if (!text) return [];

  const lines = text.split("\n");
  const sections: { heading: string; content: string }[] = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    // Match ## or ### headings
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      // Save previous section
      if (currentLines.length > 0 || currentHeading) {
        const content = currentLines.join("\n").trim();
        if (content) sections.push({ heading: currentHeading, content });
      }
      currentHeading = headingMatch[1]
        .replace(/\*\*/g, "")  // strip bold markers
        .replace(/^\s+|\s+$/g, "");
      currentLines = [];
    } else {
      // Strip markdown bold/italic for cleaner display
      currentLines.push(line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1"));
    }
  }

  // Save last section
  if (currentLines.length > 0 || currentHeading) {
    const content = currentLines.join("\n").trim();
    if (content) sections.push({ heading: currentHeading, content });
  }

  return sections;
}
