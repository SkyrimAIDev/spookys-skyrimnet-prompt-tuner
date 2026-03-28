"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopycatStore } from "@/stores/copycatStore";
import { ProposalDisplay } from "@/components/shared/ProposalDisplay";
import { sendLlmRequest } from "@/lib/llm/client";
import { applySettingsChanges, applyPromptChanges } from "@/lib/autotuner/apply-changes";
import { parseProposal } from "@/lib/autotuner/parse-proposal";
import type { CopycatPhase, CopycatRound, CopycatDialogueTurn } from "@/types/copycat";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
  Send,
  MessageSquare,
} from "lucide-react";

const PHASE_LABELS: Record<CopycatPhase, string> = {
  idle: "Waiting",
  running_reference: "Running Reference",
  running_target: "Running Target",
  comparing: "Comparing Styles",
  proposing: "Proposing Changes",
  verifying: "Verifying",
  applying: "Applying Changes",
  complete: "Complete",
  error: "Error",
  stopped: "Stopped",
};

function PhaseIcon({ phase }: { phase: CopycatPhase }) {
  switch (phase) {
    case "complete":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    case "stopped":
      return <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />;
    case "idle":
      return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
    default:
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
  }
}

function shortModelName(modelId: string): string {
  // e.g. "anthropic/claude-opus-4-6" → "claude-opus-4-6"
  const slash = modelId.lastIndexOf("/");
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

const COPYCAT_NOTICE_KEY = "skyrimnet-copycat-notice-dismissed";

function CopycatCostNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mx-4 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="text-xs font-semibold text-amber-400">
            Heads up — the default Copycat model can be expensive
          </p>
          <p className="text-[11px] text-foreground/80">
            The Copycat tuner is configured to use <span className="font-mono text-amber-300">claude-opus-4-6</span> by
            default. Opus is the recommended model for this task because it needs to deeply analyze
            dialogue style differences and produce precise tuning proposals — but it is significantly
            more expensive than most models.
          </p>
          <p className="text-[11px] text-foreground/80">
            To change the Copycat model: open <span className="font-semibold">Settings</span> (gear icon)
            → scroll to the <span className="font-semibold">Copycat</span> agent slot
            → change the <span className="font-semibold">Model Names</span> field to your preferred model.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0"
          onClick={onDismiss}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Try to extract and apply a changes JSON block from the copycat chat response.
 */
async function tryCopycatApplyChatChanges(response: string): Promise<string | null> {
  let json: { settings_changes?: unknown[]; prompt_changes?: unknown[] } | null = null;
  try {
    const jsonMatch = response.match(/\{[\s\S]*?"(?:settings_changes|prompt_changes)"[\s\S]*?\}/);
    if (jsonMatch) json = JSON.parse(jsonMatch[0]);
  } catch {
    try {
      const proposal = parseProposal(response);
      if (proposal.settingsChanges.length > 0 || proposal.promptChanges.length > 0) {
        json = {
          settings_changes: proposal.settingsChanges.map((c) => ({ parameter: c.parameter, old_value: c.oldValue, new_value: c.newValue, reason: c.reason })),
          prompt_changes: proposal.promptChanges.map((c) => ({ file_path: c.filePath, search_text: c.searchText, replace_text: c.replaceText, reason: c.reason })),
        };
      }
    } catch { /* not a proposal */ }
  }
  if (!json) return null;

  const applied: string[] = [];
  const store = useCopycatStore.getState();

  if (json.settings_changes && Array.isArray(json.settings_changes) && json.settings_changes.length > 0 && store.workingSettings) {
    try {
      const parsed = parseProposal(JSON.stringify({ settings_changes: json.settings_changes, prompt_changes: [], reasoning: "chat", stop_tuning: false }));
      if (parsed.settingsChanges.length > 0) {
        const newSettings = applySettingsChanges(store.workingSettings, parsed.settingsChanges);
        store.setWorkingSettings(newSettings);
        applied.push(`${parsed.settingsChanges.length} setting${parsed.settingsChanges.length !== 1 ? "s" : ""} updated`);
      }
    } catch { /* skip */ }
  }

  if (json.prompt_changes && Array.isArray(json.prompt_changes) && json.prompt_changes.length > 0) {
    try {
      const parsed = parseProposal(JSON.stringify({ settings_changes: [], prompt_changes: json.prompt_changes, reasoning: "chat", stop_tuning: false }));
      if (parsed.promptChanges.length > 0) {
        const sourceSetName = store.selectedPromptSet || undefined;
        const appliedPrompts = await applyPromptChanges(parsed.promptChanges, sourceSetName);
        const successCount = appliedPrompts.filter((c) => !c.reason?.startsWith("[SKIPPED]")).length;
        if (successCount > 0) applied.push(`${successCount} prompt edit${successCount !== 1 ? "s" : ""} applied`);
        const skipped = appliedPrompts.filter((c) => c.reason?.startsWith("[SKIPPED]"));
        if (skipped.length > 0) applied.push(`${skipped.length} skipped`);
      }
    } catch { /* skip */ }
  }

  return applied.length > 0 ? applied.join(", ") : null;
}

function CopycatPostTuningChatInput() {
  const [input, setInput] = useState("");
  const isStreaming = useCopycatStore((s) => s.isPostTuningStreaming);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");

    const state = useCopycatStore.getState();
    state.addPostTuningMessage({ role: "user", content: text });
    state.setIsPostTuningStreaming(true);
    state.clearPostTuningStream();

    const rounds = state.rounds;
    const summary = state.sessionSummary;
    const allPrior = state.postTuningMessages;
    const currentSettings = state.workingSettings;

    const settingsInfo = currentSettings
      ? Object.entries(currentSettings).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")
      : "No settings available.";

    const systemMsg = `You are the SkyrimNet copycat tuner agent that just completed a style-matching session. You can answer questions AND make changes.

## Your Capabilities
- **Answer questions** about the session, explain reasoning, discuss trade-offs
- **Modify settings** by including a JSON block with \`settings_changes\`
- **Edit prompts** by including a JSON block with \`prompt_changes\`

When the user asks you to make changes, include a JSON block in your response:
\`\`\`json
{
  "settings_changes": [
    { "parameter": "temperature", "old_value": 1.8, "new_value": 1.6, "reason": "reduce randomness" }
  ],
  "prompt_changes": [
    { "file_path": "/path/to/file.prompt", "search_text": "text to find", "replace_text": "replacement", "reason": "why" }
  ]
}
\`\`\`

Changes are applied immediately to the working session. The user can review and save them from the right panel.
If you're just answering a question (no changes needed), respond normally without JSON.

## Current Settings
${settingsInfo}

## Session Summary
${summary || "No summary available."}

## Session Details
${rounds.map((r) => `Round ${r.roundNumber} (${r.effectivenessScore ?? "?"}%): ${r.proposal?.reasoning || "N/A"}`).join("\n")}`;

    const messages = [
      { role: "system" as const, content: systemMsg },
      ...allPrior.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: text },
    ];

    try {
      const log = await sendLlmRequest({
        messages,
        agent: "tuner",
        onChunk: (chunk) => { useCopycatStore.getState().appendPostTuningStream(chunk); },
      });
      if (!log.error) {
        useCopycatStore.getState().addPostTuningMessage({ role: "assistant", content: log.response });
        const applyResult = await tryCopycatApplyChatChanges(log.response);
        if (applyResult) {
          useCopycatStore.getState().addPostTuningMessage({ role: "assistant", content: `Changes applied: ${applyResult}` });
        }
      }
    } catch { /* non-critical */ }
    finally {
      useCopycatStore.getState().setIsPostTuningStreaming(false);
      useCopycatStore.getState().clearPostTuningStream();
    }
  }, [input, isStreaming]);

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        placeholder="Ask about the session..."
        className="h-7 text-xs flex-1"
        disabled={isStreaming}
      />
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleSend} disabled={!input.trim() || isStreaming}>
        {isStreaming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
      </Button>
    </div>
  );
}

export function CopycatCenter() {
  const phase = useCopycatStore((s) => s.phase);
  const currentRound = useCopycatStore((s) => s.currentRound);
  const maxRounds = useCopycatStore((s) => s.maxRounds);
  const rounds = useCopycatStore((s) => s.rounds);
  const comparisonStream = useCopycatStore((s) => s.comparisonStream);
  const proposalStream = useCopycatStore((s) => s.proposalStream);
  const isRunning = useCopycatStore((s) => s.isRunning);
  const referenceModelId = useCopycatStore((s) => s.referenceModelId);
  const targetModelId = useCopycatStore((s) => s.targetModelId);
  const statusMessage = useCopycatStore((s) => s.statusMessage);
  const sessionSummary = useCopycatStore((s) => s.sessionSummary);
  const summaryStream = useCopycatStore((s) => s.summaryStream);
  const postTuningMessages = useCopycatStore((s) => s.postTuningMessages);
  const postTuningStream = useCopycatStore((s) => s.postTuningStream);

  const [showCostNotice, setShowCostNotice] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem(COPYCAT_NOTICE_KEY);
  });

  const dismissNotice = () => {
    setShowCostNotice(false);
    localStorage.setItem(COPYCAT_NOTICE_KEY, "1");
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRunning && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comparisonStream, proposalStream, isRunning, rounds, statusMessage]);

  // Auto-scroll to summary when it appears
  useEffect(() => {
    if ((sessionSummary || summaryStream) && summaryRef.current) {
      summaryRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [sessionSummary, summaryStream ? "streaming" : ""]);

  if (phase === "idle" && rounds.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {showCostNotice && <CopycatCostNotice onDismiss={dismissNotice} />}
        <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
          <div className="text-center space-y-2">
            <p>Configure the copycat in the left panel and click Start.</p>
            <p className="text-xs opacity-60">
              The copycat will run dialogue through both models, compare styles, and iteratively tune the target.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col min-w-0 overflow-hidden">
      {/* Progress header */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <PhaseIcon phase={phase} />
        <span className="text-sm font-medium">
          {isRunning
            ? `Round ${currentRound} of ${maxRounds} — ${PHASE_LABELS[phase]}`
            : `${PHASE_LABELS[phase]} — ${rounds.length} round${rounds.length !== 1 ? "s" : ""}`
          }
        </span>
        {isRunning && statusMessage && (
          <span className="text-xs text-muted-foreground ml-auto truncate">{statusMessage}</span>
        )}
      </div>

      {/* Rounds */}
      <ScrollArea className="flex-1 overflow-hidden">
        <div ref={scrollRef} className="p-4 space-y-3 min-w-0">
          {rounds.map((round, idx) => (
            <CopycatRoundCard
              key={round.roundNumber}
              round={round}
              isCurrentRound={idx === rounds.length - 1 && isRunning}
              comparisonStream={idx === rounds.length - 1 ? comparisonStream : ""}
              referenceModelId={referenceModelId}
              targetModelId={targetModelId}
              statusMessage={idx === rounds.length - 1 && isRunning ? statusMessage : ""}
            />
          ))}

          {/* Session Summary + Chat — fills the panel */}
          {(sessionSummary || summaryStream || (phase === "complete" && !isRunning)) && (
            <div ref={summaryRef} className="min-h-[calc(100vh-8rem)] flex flex-col gap-3">
              {/* Session Summary */}
              {(sessionSummary || summaryStream) && (
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border-b">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-xs font-medium text-emerald-400">Session Summary</span>
                  </div>
                  <div className="px-4 py-3 text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {sessionSummary || summaryStream}
                    {!sessionSummary && summaryStream && (
                      <Loader2 className="inline h-3 w-3 animate-spin ml-1" />
                    )}
                  </div>
                </div>
              )}

              {/* Post-Tuning Chat — grows to fill remaining space */}
              {phase === "complete" && !isRunning && (
                <div className="rounded-lg border bg-card overflow-hidden flex-1 flex flex-col">
                  <div className="flex items-center gap-2 px-3 py-2 border-b">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Ask the Tuner</span>
                  </div>
                  <div className="flex-1 p-3 space-y-2 flex flex-col">
                    <div className="flex-1 space-y-2 overflow-y-auto">
                      {postTuningMessages.map((msg, i) => (
                        <div
                          key={i}
                          className={`text-xs rounded-md px-3 py-2 ${
                            msg.role === "user"
                              ? "bg-primary/10 border border-primary/20 ml-8"
                              : "bg-muted/50 border border-muted mr-8"
                          }`}
                        >
                          <div className="text-[9px] text-muted-foreground mb-0.5 font-medium">
                            {msg.role === "user" ? "You" : "Tuner"}
                          </div>
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      ))}
                      {postTuningStream && (
                        <div className="text-xs rounded-md px-3 py-2 bg-muted/50 border border-muted mr-8">
                          <div className="text-[9px] text-muted-foreground mb-0.5 font-medium">Tuner</div>
                          <div className="whitespace-pre-wrap">
                            {postTuningStream}
                            <Loader2 className="inline h-3 w-3 animate-spin ml-1" />
                          </div>
                        </div>
                      )}
                    </div>
                    <CopycatPostTuningChatInput />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function CopycatRoundCard({
  round,
  isCurrentRound,
  comparisonStream,
  referenceModelId,
  targetModelId,
  statusMessage,
}: {
  round: CopycatRound;
  isCurrentRound: boolean;
  comparisonStream: string;
  referenceModelId: string;
  targetModelId: string;
  statusMessage: string;
}) {
  const refLabel = referenceModelId ? shortModelName(referenceModelId) : undefined;
  const tgtLabel = targetModelId ? shortModelName(targetModelId) : undefined;
  // Which section is currently active — drives auto-expand/collapse.
  // Only the active section is open; others collapse when the phase moves on.
  const activeSection: string | null = !isCurrentRound ? null :
    round.phase === "running_reference" ? "reference" :
    round.phase === "running_target" ? "target" :
    (round.phase === "comparing" || round.phase === "proposing") ? "comparison" :
    round.phase === "verifying" ? "verification" :
    round.phase === "applying" ? "proposal" :
    null;

  const [refOpen, setRefOpen] = useState(activeSection === "reference");
  const [targetOpen, setTargetOpen] = useState(activeSection === "target");
  const [sideBySideOpen, setSideBySideOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(activeSection === "comparison");
  const [proposalOpen, setProposalOpen] = useState(activeSection === "proposal");
  const [verificationOpen, setVerificationOpen] = useState(activeSection === "verification");

  // Auto-expand the active section and collapse others when the phase advances.
  // When activeSection becomes null (run ended), skip — keeps the last active section open.
  useEffect(() => {
    if (activeSection === null) return;
    setRefOpen(activeSection === "reference");
    setTargetOpen(activeSection === "target");
    setSideBySideOpen(false);
    setComparisonOpen(activeSection === "comparison");
    setProposalOpen(activeSection === "proposal");
    setVerificationOpen(activeSection === "verification");
  }, [activeSection]);

  const showComparisonStream = isCurrentRound && !round.comparisonText;

  return (
    <div className="rounded-lg border bg-card overflow-hidden min-w-0">
      {/* Round header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b min-w-0">
        <PhaseIcon phase={round.phase} />
        <span className="text-xs font-medium shrink-0">Round {round.roundNumber}</span>
        {round.effectivenessScore !== null && (
          <Badge
            variant="outline"
            className={`text-[9px] px-1.5 py-0 ml-auto shrink-0 ${
              round.effectivenessScore >= 80
                ? "border-green-500/30 text-green-400"
                : round.effectivenessScore >= 50
                  ? "border-yellow-500/30 text-yellow-400"
                  : "border-red-500/30 text-red-400"
            }`}
          >
            {round.effectivenessScore}% match
          </Badge>
        )}
        {round.error && (
          <span className="text-xs text-red-500 ml-auto truncate">{round.error}</span>
        )}
      </div>

      <div className="space-y-0">
        {/* Status message during dialogue phases */}
        {isCurrentRound && statusMessage && (round.phase === "running_reference" || round.phase === "running_target") && (
          <div className="flex items-center gap-2 px-3 py-2 border-t text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
            <span className="truncate">{statusMessage}</span>
          </div>
        )}

        {/* Reference Dialogue */}
        {round.referenceDialogue.length > 0 && (
          <CollapsibleSection
            title="Reference Dialogue"
            subtitle={refLabel}
            open={refOpen}
            onToggle={() => setRefOpen(!refOpen)}
            badge={round.roundNumber > 1 ? "Frozen from Round 1" : undefined}
          >
            <DialogueTurns turns={round.referenceDialogue} colorClass="text-blue-400" bgClass="bg-blue-500/5" />
          </CollapsibleSection>
        )}

        {/* Target Dialogue */}
        {round.targetDialogue.length > 0 && (
          <CollapsibleSection
            title="Target Dialogue"
            subtitle={tgtLabel}
            open={targetOpen}
            onToggle={() => setTargetOpen(!targetOpen)}
          >
            <DialogueTurns turns={round.targetDialogue} colorClass="text-amber-400" bgClass="bg-amber-500/5" />
          </CollapsibleSection>
        )}

        {/* Side-by-Side Comparison */}
        {round.referenceDialogue.length > 0 && round.targetDialogue.length > 0 && (
          <CollapsibleSection
            title="Side-by-Side"
            open={sideBySideOpen}
            onToggle={() => setSideBySideOpen(!sideBySideOpen)}
          >
            <div className="space-y-2 min-w-0">
              {round.referenceDialogue.map((refTurn, i) => {
                const targetTurn = round.targetDialogue[i];
                return (
                  <div key={i} className="space-y-1 min-w-0">
                    <div className="text-[10px] font-medium text-muted-foreground">{refTurn.label}</div>
                    <div className="grid grid-cols-2 gap-1 min-w-0">
                      <div className="rounded bg-blue-500/5 p-2 min-w-0 overflow-hidden">
                        <div className="text-[9px] font-medium text-blue-400 mb-0.5 truncate" title={referenceModelId}>
                          Reference{refLabel ? ` · ${refLabel}` : ""}
                        </div>
                        <pre className="whitespace-pre-wrap break-words text-xs max-h-32 overflow-auto">{refTurn.response}</pre>
                      </div>
                      <div className="rounded bg-amber-500/5 p-2 min-w-0 overflow-hidden">
                        <div className="text-[9px] font-medium text-amber-400 mb-0.5 truncate" title={targetModelId}>
                          Target{tgtLabel ? ` · ${tgtLabel}` : ""}
                        </div>
                        <pre className="whitespace-pre-wrap break-words text-xs max-h-32 overflow-auto">{targetTurn?.response || "(no response)"}</pre>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Copycat Analysis */}
        {(round.comparisonText || showComparisonStream) && (
          <CollapsibleSection
            title="Copycat Analysis"
            open={comparisonOpen}
            onToggle={() => setComparisonOpen(!comparisonOpen)}
            streaming={showComparisonStream && !!comparisonStream}
          >
            <pre className="whitespace-pre-wrap break-words text-xs max-h-64 overflow-auto">
              {round.comparisonText || comparisonStream || "Analyzing styles..."}
            </pre>
          </CollapsibleSection>
        )}

        {/* Proposed Changes */}
        {round.proposal && (
          <CollapsibleSection
            title="Proposed Changes"
            open={proposalOpen}
            onToggle={() => setProposalOpen(!proposalOpen)}
          >
            <ProposalDisplay proposal={round.proposal} />
          </CollapsibleSection>
        )}

        {/* Verification Runs */}
        {round.verificationRuns.length > 0 && (
          <CollapsibleSection
            title="Verification Runs"
            open={verificationOpen}
            onToggle={() => setVerificationOpen(!verificationOpen)}
          >
            <div className="space-y-2">
              {round.verificationRuns.map((vr, i) => (
                <div key={i} className="rounded border p-2 space-y-1">
                  <div className="text-[10px] text-muted-foreground italic">&quot;{vr.customLine}&quot;</div>
                  <pre className="whitespace-pre-wrap text-xs bg-muted/50 rounded p-1.5 max-h-32 overflow-auto">
                    {vr.response}
                  </pre>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

function DialogueTurns({
  turns,
  colorClass,
  bgClass,
}: {
  turns: CopycatDialogueTurn[];
  colorClass: string;
  bgClass: string;
}) {
  return (
    <div className="space-y-2">
      {turns.map((turn, i) => (
        <div key={i} className="space-y-0.5">
          <div className={`text-[10px] font-medium uppercase tracking-wider ${colorClass}`}>
            {turn.label}
          </div>
          <pre className={`whitespace-pre-wrap break-words text-xs ${bgClass} rounded p-2 max-h-48 overflow-auto`}>
            {turn.response || "(no response)"}
          </pre>
          {turn.latencyMs != null && (
            <div className="text-[9px] text-muted-foreground">
              {turn.latencyMs}ms {turn.totalTokens != null && `· ${turn.totalTokens} tok`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CollapsibleSection({
  title,
  subtitle,
  open,
  onToggle,
  badge,
  streaming,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  badge?: string;
  streaming?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t first:border-t-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-accent/30 transition-colors min-w-0"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground shrink-0">
          {title}
        </span>
        {subtitle && (
          <span className="text-[10px] font-mono text-muted-foreground/60 truncate" title={subtitle}>
            {subtitle}
          </span>
        )}
        {streaming && <Loader2 className="h-3 w-3 animate-spin text-blue-500 ml-1 shrink-0" />}
        {badge && (
          <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{badge}</span>
        )}
      </button>
      {open && <div className="px-3 pb-2 min-w-0 overflow-hidden">{children}</div>}
    </div>
  );
}
