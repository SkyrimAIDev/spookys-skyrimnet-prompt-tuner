"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopycatStore } from "@/stores/copycatStore";
import { ProposalDisplay } from "@/components/shared/ProposalDisplay";
import { SessionSummaryPanel } from "@/components/shared/SessionSummaryPanel";
import { sendLlmRequest } from "@/lib/llm/client";
import {
  buildPostTuningSystemPrompt,
  parseToolCalls,
  stripToolCallXml,
  executeToolCall,
  buildAgentMessages,
} from "@/lib/autotuner/post-tuning-agent";
import type { CopycatPhase, CopycatRound, CopycatDialogueTurn } from "@/types/copycat";
import type { AiTuningSettings } from "@/types/config";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
  Square,
  Copy,
  Check,
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

function CopycatCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover/msg:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

const MAX_COPYCAT_TOOL_ITERATIONS = 5;

function CopycatPostTuningChatInput() {
  const [input, setInput] = useState("");
  const isStreaming = useCopycatStore((s) => s.isPostTuningStreaming);
  const abortRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => { abortRef.current?.abort(); }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");

    const controller = new AbortController();
    abortRef.current = controller;

    const store = useCopycatStore.getState();
    store.addPostTuningMessage({ role: "user", content: text });
    store.setIsPostTuningStreaming(true);
    store.clearPostTuningStream();

    const systemPrompt = buildPostTuningSystemPrompt(
      store.sessionSummary,
      store.rounds.length,
    );

    let currentMessages = buildAgentMessages(systemPrompt, store.postTuningMessages, text);
    const appliedActions: string[] = [];

    try {
      for (let iteration = 0; iteration < MAX_COPYCAT_TOOL_ITERATIONS; iteration++) {
        const log = await sendLlmRequest({
          messages: currentMessages,
          agent: "tuner",
          onChunk: (chunk) => { useCopycatStore.getState().appendPostTuningStream(chunk); },
          signal: controller.signal,
        });
        if (log.error) break;

        const toolCalls = parseToolCalls(log.response);
        if (toolCalls.length === 0) {
          useCopycatStore.getState().addPostTuningMessage({ role: "assistant", content: log.response });
          break;
        }

        const toolResults: string[] = [];
        const ctx = {
          rounds: useCopycatStore.getState().rounds,
          workingSettings: useCopycatStore.getState().workingSettings,
          setWorkingSettings: (s: AiTuningSettings) => useCopycatStore.getState().setWorkingSettings(s),
          sourceSetName: useCopycatStore.getState().selectedPromptSet || undefined,
          getCopycatRoundExtra: (idx: number) => {
            const r = useCopycatStore.getState().rounds[idx];
            if (!r) return "";
            let extra = "";
            if (r.effectivenessScore !== null) extra += `\n**Effectiveness:** ${r.effectivenessScore}%`;
            if (r.comparisonText) extra += `\n**Comparison:** ${r.comparisonText.substring(0, 500)}${r.comparisonText.length > 500 ? "..." : ""}`;
            return extra;
          },
        };

        for (const call of toolCalls) {
          const { result, applied } = await executeToolCall(call, ctx);
          toolResults.push(`[Tool: ${call.name}]\n${result}`);
          if (applied) appliedActions.push(applied);
        }

        // Add display text as message BEFORE clearing stream to avoid flash
        const displayText = stripToolCallXml(log.response);
        if (displayText) {
          useCopycatStore.getState().addPostTuningMessage({ role: "assistant", content: displayText });
        }
        useCopycatStore.getState().clearPostTuningStream();

        currentMessages = [
          ...currentMessages,
          { role: "assistant" as const, content: log.response },
          { role: "user" as const, content: toolResults.join("\n\n") },
        ];
      }

      if (appliedActions.length > 0) {
        useCopycatStore.getState().addPostTuningMessage({ role: "assistant", content: `Changes applied: ${appliedActions.join(", ")}` });
      }
    } catch {
      const partial = useCopycatStore.getState().postTuningStream;
      if (partial) useCopycatStore.getState().addPostTuningMessage({ role: "assistant", content: partial });
    } finally {
      useCopycatStore.getState().setIsPostTuningStreaming(false);
      useCopycatStore.getState().clearPostTuningStream();
      abortRef.current = null;
    }
  }, [input, isStreaming]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape" && isStreaming) handleStop(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isStreaming, handleStop]);

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
      {isStreaming ? (
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleStop} title="Stop (Esc)">
          <Square className="h-3 w-3" />
        </Button>
      ) : (
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleSend} disabled={!input.trim()}>
          <Send className="h-3 w-3" />
        </Button>
      )}
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
  const originalSettings = useCopycatStore((s) => s.originalSettings);
  const workingSettings = useCopycatStore((s) => s.workingSettings);

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
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRunning && scrollRef.current) {
      const viewport = scrollRef.current.closest("[data-radix-scroll-area-viewport]");
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
  }, [comparisonStream, proposalStream, isRunning, rounds, statusMessage]);

  // Auto-scroll to summary when it appears
  useEffect(() => {
    if ((sessionSummary || summaryStream) && summaryRef.current) {
      summaryRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [sessionSummary, summaryStream ? "streaming" : ""]);

  // Auto-scroll to bottom on new chat messages or streaming
  useEffect(() => {
    if ((postTuningMessages.length > 0 || postTuningStream) && scrollRef.current) {
      requestAnimationFrame(() => {
        const viewport = scrollRef.current?.closest("[data-radix-scroll-area-viewport]");
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    }
  }, [postTuningMessages, postTuningStream]);

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
        {phase === "complete" && !isRunning && (sessionSummary || postTuningMessages.length > 0) && (
          <div className="flex items-center gap-1 ml-auto">
            {rounds.length > 0 && (
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-2" onClick={() => {
                const viewport = scrollRef.current?.closest("[data-radix-scroll-area-viewport]");
                if (viewport) viewport.scrollTop = 0;
              }}>
                Rounds
              </Button>
            )}
            {sessionSummary && (
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-2" onClick={() => {
                summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}>
                Summary
              </Button>
            )}
            {postTuningMessages.length > 0 && (
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-2" onClick={() => {
                const viewport = scrollRef.current?.closest("[data-radix-scroll-area-viewport]");
                if (viewport) viewport.scrollTop = viewport.scrollHeight;
              }}>
                Chat
              </Button>
            )}
          </div>
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

          {/* Session Summary */}
          {(sessionSummary || summaryStream) && (
            <div ref={summaryRef}>
              <SessionSummaryPanel
                summaryText={sessionSummary}
                summaryStream={summaryStream}
                rounds={rounds}
                originalSettings={originalSettings}
                finalSettings={workingSettings}
              />
            </div>
          )}

          {/* Chat messages (scrollable part) */}
          {phase === "complete" && !isRunning && (
            <div className="space-y-2" ref={chatScrollRef}>
              <div className="flex items-center gap-2 px-1">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Ask the Tuner</span>
              </div>
              {postTuningMessages.length === 0 && !postTuningStream && (
                <div className="text-xs text-muted-foreground/50 text-center py-4">
                  Ask questions about the session or request further changes.
                </div>
              )}
              {postTuningMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`group/msg text-xs rounded-md px-3 py-2 ${
                    msg.role === "user"
                      ? "bg-primary/10 border border-primary/20 ml-8"
                      : "bg-muted/50 border border-muted mr-8"
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="text-[9px] text-muted-foreground font-medium">
                      {msg.role === "user" ? "You" : "Tuner"}
                    </div>
                    {msg.role === "assistant" && (
                      <CopycatCopyButton text={msg.content} />
                    )}
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
          )}
        </div>
      </ScrollArea>

      {/* Chat input — pinned at bottom outside ScrollArea */}
      {phase === "complete" && !isRunning && (
        <div className="border-t p-2 shrink-0">
          <CopycatPostTuningChatInput />
        </div>
      )}
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
