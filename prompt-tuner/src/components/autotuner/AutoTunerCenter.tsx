"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAutoTunerStore } from "@/stores/autoTunerStore";
import { ProposalDisplay } from "@/components/shared/ProposalDisplay";
import { ChatChangeDisplay, hasStructuredChanges } from "@/components/shared/ChatChangeDisplay";
import { SessionSummaryPanel } from "@/components/shared/SessionSummaryPanel";
import { sendLlmRequest } from "@/lib/llm/client";
import {
  buildPostTuningSystemPrompt,
  parseToolCalls,
  stripToolCallXml,
  executeToolCall,
  buildAgentMessages,
  type ToolCall,
  type AppliedChange,
} from "@/lib/autotuner/post-tuning-agent";
import type { TunerPhase, TunerRound } from "@/types/autotuner";
import type { AiTuningSettings } from "@/types/config";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Send,
  MessageSquare,
  Square,
  Copy,
  Check,
} from "lucide-react";
import type { ChatMessage } from "@/types/llm";

/**
 * Derive a contextual label for a message in a SkyrimNet dialogue prompt.
 */
function getMessageLabel(
  message: ChatMessage,
  index: number,
  allMessages: ChatMessage[],
): { label: string; colorClass: string } {
  if (message.role === "system") {
    return { label: "SYSTEM", colorClass: "text-blue-400" };
  }

  let lastUserIdx = -1;
  for (let i = allMessages.length - 1; i >= 0; i--) {
    if (allMessages[i].role === "user") { lastUserIdx = i; break; }
  }

  let secondLastUserIdx = -1;
  for (let i = lastUserIdx - 1; i >= 0; i--) {
    if (allMessages[i].role === "user") { secondLastUserIdx = i; break; }
  }

  if (message.role === "user") {
    if (index === lastUserIdx) return { label: "INSTRUCTIONS", colorClass: "text-yellow-400" };
    if (index === secondLastUserIdx) return { label: "PLAYER", colorClass: "text-green-400" };
    return { label: "PREV PLAYER", colorClass: "text-green-400/60" };
  }

  if (message.role === "assistant") {
    if (secondLastUserIdx !== -1 && index > secondLastUserIdx) {
      return { label: "NPC", colorClass: "text-amber-400" };
    }
    return { label: "PREV NPC", colorClass: "text-amber-400/60" };
  }

  return { label: String(message.role).toUpperCase(), colorClass: "text-muted-foreground" };
}

import { TUNER_PHASE_LABELS as PHASE_LABELS } from "@/lib/constants/phase-labels";

function PhaseIcon({ phase }: { phase: TunerPhase }) {
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

function CopyButton({ text }: { text: string }) {
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

function PostTuningStreamBubble({ stream }: { stream: string }) {
  const [showVerbose, setShowVerbose] = useState(false);
  return (
    <div className="text-xs rounded-md px-3 py-2 bg-muted/50 border border-muted mr-8">
      <div className="flex items-center gap-2 text-[9px] text-muted-foreground mb-0.5">
        <span className="font-medium">Tuner</span>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Working on it...</span>
        <button
          onClick={() => setShowVerbose((v) => !v)}
          className="ml-auto text-[9px] text-muted-foreground/60 hover:text-muted-foreground underline"
        >
          {showVerbose ? "Hide details" : "Show details"}
        </button>
      </div>
      {showVerbose && (
        <pre className="whitespace-pre-wrap break-words text-[10px] text-muted-foreground/80 max-h-60 overflow-auto mt-1 pt-1 border-t border-border/30">
          {stream}
        </pre>
      )}
    </div>
  );
}

const MAX_TOOL_ITERATIONS = 5;

function PostTuningChatInput() {
  const [input, setInput] = useState("");
  const isStreaming = useAutoTunerStore((s) => s.isPostTuningStreaming);
  const abortRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");

    const controller = new AbortController();
    abortRef.current = controller;

    const store = useAutoTunerStore.getState();
    store.addPostTuningMessage({ role: "user", content: text });
    store.setIsPostTuningStreaming(true);
    store.clearPostTuningStream();

    // Collect file paths modified during the session
    const modifiedPaths = new Set<string>();
    for (const r of store.rounds) {
      for (const pc of r.proposal?.promptChanges || []) {
        if (pc.filePath && !pc.reason?.startsWith("[SKIPPED]")) modifiedPaths.add(pc.filePath);
      }
    }

    const systemPrompt = buildPostTuningSystemPrompt(
      store.sessionSummary,
      store.rounds.length,
      [...modifiedPaths],
    );

    // Agent loop: send message, check for tool calls, execute, feed results back
    let currentMessages = buildAgentMessages(
      systemPrompt,
      store.postTuningMessages,
      text,
    );
    const appliedActions: AppliedChange[] = [];

    try {
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        // Stream all iterations to the buffer — UI shows verbose toggle
        const log = await sendLlmRequest({
          messages: currentMessages,
          agent: "tuner",
          onChunk: (chunk) => { useAutoTunerStore.getState().appendPostTuningStream(chunk); },
          signal: controller.signal,
        });

        if (log.error) break;

        const toolCalls = parseToolCalls(log.response);

        if (toolCalls.length === 0) {
          // Final response — display it
          useAutoTunerStore.getState().clearPostTuningStream();
          useAutoTunerStore.getState().addPostTuningMessage({ role: "assistant", content: log.response });
          break;
        }

        // Execute tool calls silently
        const toolResults: string[] = [];
        const ctx = {
          rounds: useAutoTunerStore.getState().rounds,
          workingSettings: useAutoTunerStore.getState().workingSettings,
          setWorkingSettings: (s: AiTuningSettings) => useAutoTunerStore.getState().setWorkingSettings(s),
          sourceSetName: useAutoTunerStore.getState().selectedPromptSet || undefined,
        };

        for (const call of toolCalls) {
          const { result, applied } = await executeToolCall(call, ctx);
          toolResults.push(`[Tool: ${call.name}]\n${result}`);
          if (applied) appliedActions.push(applied);
        }

        currentMessages = [
          ...currentMessages,
          { role: "assistant" as const, content: log.response },
          { role: "user" as const, content: toolResults.join("\n\n") },
        ];

        // Add separator for next iteration's stream
        useAutoTunerStore.getState().appendPostTuningStream("\n\n---\n\n");
      }

      // Report applied actions with structured display
      if (appliedActions.length > 0) {
        const changeLines: string[] = [];
        for (const action of appliedActions) {
          if (action.type === "settings" && action.settingsChanges) {
            changeLines.push("__SETTINGS_TABLE__" + JSON.stringify(action.settingsChanges));
          }
          if (action.type === "prompt" && action.promptChanges) {
            changeLines.push("__PROMPT_DIFF__" + JSON.stringify(action.promptChanges));
          }
        }
        useAutoTunerStore.getState().addPostTuningMessage({
          role: "assistant",
          content: changeLines.join("\n"),
        });
      }
    } catch {
      const partial = useAutoTunerStore.getState().postTuningStream;
      if (partial) {
        useAutoTunerStore.getState().addPostTuningMessage({ role: "assistant", content: partial });
      }
    } finally {
      useAutoTunerStore.getState().setIsPostTuningStreaming(false);
      useAutoTunerStore.getState().clearPostTuningStream();
      abortRef.current = null;
    }
  }, [input, isStreaming]);

  // Escape key to stop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isStreaming) handleStop();
    };
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

export function AutoTunerCenter() {
  const phase = useAutoTunerStore((s) => s.phase);
  const currentRound = useAutoTunerStore((s) => s.currentRound);
  const maxRounds = useAutoTunerStore((s) => s.maxRounds);
  const rounds = useAutoTunerStore((s) => s.rounds);
  const explanationStream = useAutoTunerStore((s) => s.explanationStream);
  const assessmentStream = useAutoTunerStore((s) => s.assessmentStream);
  const proposalStream = useAutoTunerStore((s) => s.proposalStream);
  const isRunning = useAutoTunerStore((s) => s.isRunning);
  const statusMessage = useAutoTunerStore((s) => s.statusMessage);
  const sessionSummary = useAutoTunerStore((s) => s.sessionSummary);
  const summaryStream = useAutoTunerStore((s) => s.summaryStream);
  const postTuningMessages = useAutoTunerStore((s) => s.postTuningMessages);
  const postTuningStream = useAutoTunerStore((s) => s.postTuningStream);
  const originalSettings = useAutoTunerStore((s) => s.originalSettings);
  const workingSettings = useAutoTunerStore((s) => s.workingSettings);

  const scrollRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);

  // Simple approach: check if viewport is near bottom BEFORE scrolling.
  // No scroll event listeners — no feedback loops.
  const getViewport = useCallback(() => scrollRef.current?.closest("[data-radix-scroll-area-viewport]") as HTMLElement | null, []);

  const isNearBottom = useCallback(() => {
    const viewport = getViewport();
    if (!viewport) return true;
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
  }, [getViewport]);

  const scrollToBottom = useCallback(() => {
    const viewport = getViewport();
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [getViewport]);

  const jumpToLatest = useCallback(() => {
    scrollToBottom();
    setShowJumpButton(false);
  }, [scrollToBottom]);

  // Auto-scroll during streaming — only if already near bottom
  useEffect(() => {
    if (!isRunning) return;
    if (isNearBottom()) {
      scrollToBottom();
      setShowJumpButton(false);
    } else {
      setShowJumpButton(true);
    }
  }, [explanationStream, assessmentStream, proposalStream, isRunning, rounds, statusMessage, isNearBottom, scrollToBottom]);

  // Auto-scroll to summary when it appears
  useEffect(() => {
    if ((sessionSummary || summaryStream) && summaryRef.current && isNearBottom()) {
      summaryRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [sessionSummary, summaryStream ? "streaming" : "", isNearBottom]);

  // Auto-scroll on new chat messages
  useEffect(() => {
    if ((postTuningMessages.length > 0 || postTuningStream) && isNearBottom()) {
      requestAnimationFrame(scrollToBottom);
    }
  }, [postTuningMessages, postTuningStream, isNearBottom, scrollToBottom]);

  // Reset jump button when run starts
  useEffect(() => {
    if (isRunning) setShowJumpButton(false);
  }, [isRunning]);

  if (phase === "idle" && rounds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <p>Configure the tuner in the left panel and click Start.</p>
          <p className="text-xs opacity-60">
            The auto tuner will benchmark, assess, and iteratively improve your model&apos;s settings.
          </p>
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

      {/* Rounds + Summary in scrollable area */}
      <div className="flex-1 overflow-hidden relative">
      <ScrollArea className="h-full">
        <div ref={scrollRef} className="p-4 space-y-3 min-w-0">
          {rounds.map((round, idx) => (
            <TunerRoundCard
              key={round.roundNumber}
              round={round}
              isCurrentRound={idx === rounds.length - 1 && isRunning}
              forceCollapse={idx === rounds.length - 1 && !isRunning && !!(sessionSummary || summaryStream)}
              explanationStream={idx === rounds.length - 1 ? explanationStream : ""}
              assessmentStream={idx === rounds.length - 1 ? assessmentStream : ""}
              proposalStream={idx === rounds.length - 1 ? proposalStream : ""}
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
                      <CopyButton text={msg.content} />
                    )}
                  </div>
                  {hasStructuredChanges(msg.content)
                    ? <ChatChangeDisplay content={msg.content} />
                    : <div className="whitespace-pre-wrap">{msg.content}</div>
                  }
                </div>
              ))}
              {postTuningStream && (
                <PostTuningStreamBubble stream={postTuningStream} />
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Jump to latest button — appears when user scrolls away during a run */}
      {showJumpButton && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-3 right-5 z-10 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[10px] font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        >
          <ChevronDown className="h-3 w-3" />
          Jump to latest
        </button>
      )}
      </div>

      {/* Chat input — pinned at bottom outside ScrollArea */}
      {phase === "complete" && !isRunning && (
        <div className="border-t p-2 shrink-0">
          <PostTuningChatInput />
        </div>
      )}
    </div>
  );
}

function TunerRoundCard({
  round,
  isCurrentRound,
  forceCollapse = false,
  explanationStream,
  assessmentStream,
  proposalStream,
  statusMessage,
}: {
  round: TunerRound;
  isCurrentRound: boolean;
  forceCollapse?: boolean;
  explanationStream: string;
  assessmentStream: string;
  proposalStream: string;
  statusMessage: string;
}) {
  // Which section is currently active — drives auto-expand/collapse.
  // Only the active section is open; others collapse when the phase moves on.
  const activeSection: string | null = !isCurrentRound ? null :
    round.phase === "benchmarking" ? "response" :
    round.phase === "explaining" ? "explanation" :
    round.phase === "assessing" ? "assessment" :
    (round.phase === "proposing" || round.phase === "applying") ? "proposal" :
    null;

  const [promptOpen, setPromptOpen] = useState(false);
  const [turnsOpen, setTurnsOpen] = useState<Record<number, boolean>>({});
  const [responseOpen, setResponseOpen] = useState(activeSection === "response");
  const [explanationOpen, setExplanationOpen] = useState(activeSection === "explanation");
  const [assessOpen, setAssessOpen] = useState(activeSection === "assessment");
  const [proposalOpen, setProposalOpen] = useState(activeSection === "proposal");

  // Track which sections the user has manually toggled — auto-collapse respects these
  const userPinned = useRef(new Set<string>());

  // Wrap setters to track user interaction
  const userToggleResponse = useCallback(() => { userPinned.current.add("response"); setResponseOpen((v) => !v); }, []);
  const userToggleExplanation = useCallback(() => { userPinned.current.add("explanation"); setExplanationOpen((v) => !v); }, []);
  const userToggleAssessment = useCallback(() => { userPinned.current.add("assessment"); setAssessOpen((v) => !v); }, []);
  const userToggleProposal = useCallback(() => { userPinned.current.add("proposal"); setProposalOpen((v) => !v); }, []);

  // Collapse all sections when summary appears (overrides user pins)
  useEffect(() => {
    if (forceCollapse) {
      userPinned.current.clear();
      setPromptOpen(false);
      setResponseOpen(false);
      setExplanationOpen(false);
      setAssessOpen(false);
      setProposalOpen(false);
    }
  }, [forceCollapse]);

  // Auto-expand the active section and collapse others when the phase advances.
  // Sections the user has manually toggled are left alone.
  useEffect(() => {
    if (activeSection === null) {
      if (!isCurrentRound && round.phase === "complete") {
        // Round completed — collapse unpinned sections
        if (!userPinned.current.has("response")) setResponseOpen(false);
        if (!userPinned.current.has("explanation")) setExplanationOpen(false);
        if (!userPinned.current.has("assessment")) setAssessOpen(false);
        if (!userPinned.current.has("proposal")) setProposalOpen(false);
        setTurnsOpen({});
      }
      return;
    }
    // Auto-expand active, collapse others unless user pinned them
    if (!userPinned.current.has("response")) setResponseOpen(activeSection === "response");
    if (!userPinned.current.has("explanation")) setExplanationOpen(activeSection === "explanation");
    if (!userPinned.current.has("assessment")) setAssessOpen(activeSection === "assessment");
    if (!userPinned.current.has("proposal")) setProposalOpen(activeSection === "proposal");
    if (!userPinned.current.has("turns")) setTurnsOpen(activeSection === "response" ? {} : { 0: false });
  }, [activeSection, isCurrentRound, round.phase]);

  const benchResult = round.benchmarkResult;
  const turnResults = round.turnResults;
  const isMultiTurn = turnResults && turnResults.length > 0;
  const showExplanationStream = isCurrentRound && !!benchResult && !benchResult.explanation;
  const showAssessmentStream = isCurrentRound && !round.assessmentText;
  const showProposalStream = isCurrentRound && !round.proposal;

  // Explanation display text
  const explanationText = benchResult?.explanation || "";
  const explanationDisplay = explanationText || (showExplanationStream ? explanationStream : "");

  const toggleTurn = (idx: number) =>
    setTurnsOpen((prev) => ({ ...prev, [idx]: !prev[idx] }));

  return (
    <div className="rounded-lg border bg-card overflow-hidden min-w-0">
      {/* Round header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b min-w-0">
        <PhaseIcon phase={round.phase} />
        <span className="text-xs font-medium">Round {round.roundNumber}</span>
        {benchResult && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {benchResult.latencyMs}ms · {benchResult.totalTokens} tok
          </span>
        )}
        {round.error && (
          <span className="text-xs text-red-500 ml-auto">{round.error}</span>
        )}
      </div>

      <div className="space-y-0">
        {/* Status message during benchmarking */}
        {isCurrentRound && statusMessage && round.phase === "benchmarking" && (
          <div className="flex items-center gap-2 px-3 py-2 border-t text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
            <span className="truncate">{statusMessage}</span>
          </div>
        )}

        {/* Multi-turn: per-turn sections */}
        {isMultiTurn ? (
          <>
            {turnResults.map((turn, tIdx) => (
              <CollapsibleSection
                key={tIdx}
                title={turn.label}
                open={turnsOpen[tIdx] ?? (tIdx === 0)}
                onToggle={() => toggleTurn(tIdx)}
                badge={`${turn.messages.length} messages`}
              >
                <div className="space-y-2">
                  {/* Prompt messages for this turn */}
                  <div className="space-y-1.5">
                    {turn.messages.map((msg, i) => {
                      const { label, colorClass } = getMessageLabel(msg, i, turn.messages);
                      return (
                        <div key={i} className="space-y-0.5">
                          <div className={`text-[10px] font-medium uppercase tracking-wider ${colorClass}`}>
                            {label}
                          </div>
                          <pre className="whitespace-pre-wrap text-xs bg-muted/50 rounded p-2 max-h-64 overflow-auto">
                            {msg.content}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                  {/* Response for this turn */}
                  <div className="space-y-0.5">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-400">
                      Response
                    </div>
                    <pre className="whitespace-pre-wrap text-xs bg-emerald-500/5 rounded p-2 max-h-64 overflow-auto">
                      {turn.response || "(no response)"}
                    </pre>
                  </div>
                </div>
              </CollapsibleSection>
            ))}
            {/* Aggregated stats */}
            {benchResult && (
              <div className="px-3 py-1.5 border-t">
                <div className="flex gap-4 text-[10px] text-muted-foreground">
                  <span>Total Latency: {benchResult.latencyMs}ms</span>
                  <span>Prompt: {benchResult.promptTokens}</span>
                  <span>Completion: {benchResult.completionTokens}</span>
                  <span>Total: {benchResult.totalTokens}</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Single-turn: Rendered Prompt */}
            {benchResult && benchResult.messages.length > 0 && (
              <CollapsibleSection
                title="Rendered Prompt"
                open={promptOpen}
                onToggle={() => setPromptOpen(!promptOpen)}
                badge={`${benchResult.messages.length} messages`}
              >
                <div className="space-y-1.5">
                  {benchResult.messages.map((msg, i) => {
                    const { label, colorClass } = getMessageLabel(msg, i, benchResult.messages);
                    return (
                      <div key={i} className="space-y-0.5">
                        <div className={`text-[10px] font-medium uppercase tracking-wider ${colorClass}`}>
                          {label}
                        </div>
                        <pre className="whitespace-pre-wrap text-xs bg-muted/50 rounded p-2 max-h-64 overflow-auto">
                          {msg.content}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            )}

            {/* Single-turn: Model Response */}
            {benchResult && (
              <CollapsibleSection
                title="Model Response"
                open={responseOpen}
                onToggle={userToggleResponse}
              >
                <div className="space-y-2">
                  <pre className="whitespace-pre-wrap text-xs bg-muted/50 rounded p-2 max-h-64 overflow-auto">
                    {benchResult.response || "(no response)"}
                  </pre>
                  <div className="flex gap-4 text-[10px] text-muted-foreground">
                    <span>Latency: {benchResult.latencyMs}ms</span>
                    <span>Prompt: {benchResult.promptTokens}</span>
                    <span>Completion: {benchResult.completionTokens}</span>
                    <span>Total: {benchResult.totalTokens}</span>
                  </div>
                </div>
              </CollapsibleSection>
            )}
          </>
        )}

        {/* Self-Explanation */}
        {(explanationDisplay || showExplanationStream) && (
          <CollapsibleSection
            title="Self-Explanation"
            open={explanationOpen}
            onToggle={userToggleExplanation}
            streaming={showExplanationStream && !!explanationStream}
          >
            <pre className="whitespace-pre-wrap text-xs text-amber-300/80 bg-amber-500/5 rounded p-2 max-h-48 overflow-auto">
              {explanationDisplay || "Generating explanation..."}
            </pre>
          </CollapsibleSection>
        )}

        {/* Assessment */}
        {(round.assessmentText || showAssessmentStream) && (
          <CollapsibleSection
            title="Assessment"
            open={assessOpen}
            onToggle={userToggleAssessment}
            streaming={showAssessmentStream && !!assessmentStream}
          >
            <pre className="whitespace-pre-wrap text-xs max-h-64 overflow-auto">
              {round.assessmentText || assessmentStream || "Analyzing..."}
            </pre>
          </CollapsibleSection>
        )}

        {/* Proposal */}
        {(round.proposal || showProposalStream) && (
          <CollapsibleSection
            title="Proposed Changes"
            open={proposalOpen}
            onToggle={userToggleProposal}
            streaming={showProposalStream && !!proposalStream}
          >
            {round.proposal ? (
              <ProposalDisplay proposal={round.proposal} />
            ) : proposalStream ? (
              <pre className="whitespace-pre-wrap text-xs max-h-64 overflow-auto">
                {proposalStream}
              </pre>
            ) : (
              <span className="text-xs text-muted-foreground">Thinking...</span>
            )}
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  badge,
  streaming,
  children,
}: {
  title: string;
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
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-accent/30 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {streaming && <Loader2 className="h-3 w-3 animate-spin text-blue-500 ml-1" />}
        {badge && (
          <span className="ml-auto text-[10px] text-muted-foreground">{badge}</span>
        )}
      </button>
      {open && <div className="px-3 pb-2 min-w-0 overflow-hidden">{children}</div>}
    </div>
  );
}

