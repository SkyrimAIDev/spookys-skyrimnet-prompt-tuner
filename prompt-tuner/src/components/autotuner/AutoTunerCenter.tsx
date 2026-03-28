"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAutoTunerStore } from "@/stores/autoTunerStore";
import { ProposalDisplay } from "@/components/shared/ProposalDisplay";
import { sendLlmRequest } from "@/lib/llm/client";
import { applySettingsChanges, applyPromptChanges } from "@/lib/autotuner/apply-changes";
import { parseProposal } from "@/lib/autotuner/parse-proposal";
import type { TunerPhase, TunerRound } from "@/types/autotuner";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Send,
  MessageSquare,
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

const PHASE_LABELS: Record<TunerPhase, string> = {
  idle: "Waiting",
  benchmarking: "Running Benchmark",
  explaining: "Self-Explanation",
  assessing: "Assessing Quality",
  proposing: "Proposing Changes",
  applying: "Applying Changes",
  complete: "Complete",
  error: "Error",
  stopped: "Stopped",
};

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

/**
 * Try to extract and apply a changes JSON block from the chat response.
 * Returns a status message describing what was applied, or null if no changes found.
 */
async function tryApplyChatChanges(response: string): Promise<string | null> {
  // Look for a JSON block in the response (same format as proposals)
  let json: { settings_changes?: unknown[]; prompt_changes?: unknown[] } | null = null;
  try {
    // Try to find JSON in the response — look for { that contains settings_changes or prompt_changes
    const jsonMatch = response.match(/\{[\s\S]*?"(?:settings_changes|prompt_changes)"[\s\S]*?\}/);
    if (jsonMatch) {
      json = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Try parsing via the existing proposal parser which handles edge cases
    try {
      const proposal = parseProposal(response);
      if (proposal.settingsChanges.length > 0 || proposal.promptChanges.length > 0) {
        json = {
          settings_changes: proposal.settingsChanges.map((c) => ({
            parameter: c.parameter,
            old_value: c.oldValue,
            new_value: c.newValue,
            reason: c.reason,
          })),
          prompt_changes: proposal.promptChanges.map((c) => ({
            file_path: c.filePath,
            search_text: c.searchText,
            replace_text: c.replaceText,
            reason: c.reason,
          })),
        };
      }
    } catch { /* not a proposal */ }
  }

  if (!json) return null;

  const applied: string[] = [];
  const store = useAutoTunerStore.getState();

  // Apply settings changes
  if (json.settings_changes && Array.isArray(json.settings_changes) && json.settings_changes.length > 0 && store.workingSettings) {
    try {
      const parsed = parseProposal(JSON.stringify({
        settings_changes: json.settings_changes,
        prompt_changes: [],
        reasoning: "chat",
        stop_tuning: false,
      }));
      if (parsed.settingsChanges.length > 0) {
        const newSettings = applySettingsChanges(store.workingSettings, parsed.settingsChanges);
        store.setWorkingSettings(newSettings);
        applied.push(`${parsed.settingsChanges.length} setting${parsed.settingsChanges.length !== 1 ? "s" : ""} updated`);
      }
    } catch { /* skip */ }
  }

  // Apply prompt changes
  if (json.prompt_changes && Array.isArray(json.prompt_changes) && json.prompt_changes.length > 0) {
    try {
      const parsed = parseProposal(JSON.stringify({
        settings_changes: [],
        prompt_changes: json.prompt_changes,
        reasoning: "chat",
        stop_tuning: false,
      }));
      if (parsed.promptChanges.length > 0) {
        const sourceSetName = store.selectedPromptSet || undefined;
        const appliedPrompts = await applyPromptChanges(parsed.promptChanges, sourceSetName);
        const successCount = appliedPrompts.filter((c) => !c.reason?.startsWith("[SKIPPED]")).length;
        if (successCount > 0) {
          applied.push(`${successCount} prompt edit${successCount !== 1 ? "s" : ""} applied`);
        }
        const skipped = appliedPrompts.filter((c) => c.reason?.startsWith("[SKIPPED]"));
        if (skipped.length > 0) {
          applied.push(`${skipped.length} skipped`);
        }
      }
    } catch { /* skip */ }
  }

  return applied.length > 0 ? applied.join(", ") : null;
}

function PostTuningChatInput() {
  const [input, setInput] = useState("");
  const isStreaming = useAutoTunerStore((s) => s.isPostTuningStreaming);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");

    const state = useAutoTunerStore.getState();
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

    const systemMsg = `You are the SkyrimNet tuner agent that just completed a tuning session. You can answer questions AND make changes.

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
${rounds.map((r) => `Round ${r.roundNumber}: ${r.proposal?.reasoning || "N/A"}`).join("\n")}`;

    const messages = [
      { role: "system" as const, content: systemMsg },
      ...allPrior.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: text },
    ];

    try {
      const log = await sendLlmRequest({
        messages,
        agent: "tuner",
        onChunk: (chunk) => { useAutoTunerStore.getState().appendPostTuningStream(chunk); },
      });
      if (!log.error) {
        useAutoTunerStore.getState().addPostTuningMessage({ role: "assistant", content: log.response });

        // Try to apply any changes from the response
        const applyResult = await tryApplyChatChanges(log.response);
        if (applyResult) {
          useAutoTunerStore.getState().addPostTuningMessage({
            role: "assistant",
            content: `✅ Changes applied: ${applyResult}`,
          });
        }
      }
    } catch { /* non-critical */ }
    finally {
      useAutoTunerStore.getState().setIsPostTuningStreaming(false);
      useAutoTunerStore.getState().clearPostTuningStream();
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (isRunning && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [explanationStream, assessmentStream, proposalStream, isRunning, rounds, statusMessage]);

  // Auto-scroll to summary when it appears
  useEffect(() => {
    if ((sessionSummary || summaryStream) && summaryRef.current) {
      summaryRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [sessionSummary, summaryStream ? "streaming" : ""]);

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
      </div>

      {/* Rounds */}
      <ScrollArea className="flex-1 overflow-hidden">
        <div ref={scrollRef} className="p-4 space-y-3 min-w-0">
          {rounds.map((round, idx) => (
            <TunerRoundCard
              key={round.roundNumber}
              round={round}
              isCurrentRound={idx === rounds.length - 1 && isRunning}
              explanationStream={idx === rounds.length - 1 ? explanationStream : ""}
              assessmentStream={idx === rounds.length - 1 ? assessmentStream : ""}
              proposalStream={idx === rounds.length - 1 ? proposalStream : ""}
              statusMessage={idx === rounds.length - 1 && isRunning ? statusMessage : ""}
            />
          ))}

          {/* Session Summary + Chat — fills the panel so user doesn't need to scroll to find it */}
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
                    <PostTuningChatInput />
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

function TunerRoundCard({
  round,
  isCurrentRound,
  explanationStream,
  assessmentStream,
  proposalStream,
  statusMessage,
}: {
  round: TunerRound;
  isCurrentRound: boolean;
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

  // Auto-expand the active section and collapse others when the phase advances.
  // When activeSection becomes null (run ended), skip — keeps the last active section open.
  useEffect(() => {
    if (activeSection === null) return;
    setResponseOpen(activeSection === "response");
    setExplanationOpen(activeSection === "explanation");
    setAssessOpen(activeSection === "assessment");
    setProposalOpen(activeSection === "proposal");
    // Collapse multi-turn sections when moving past benchmarking
    setTurnsOpen(activeSection === "response" ? {} : { 0: false });
  }, [activeSection]);

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
                onToggle={() => setResponseOpen(!responseOpen)}
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
            onToggle={() => setExplanationOpen(!explanationOpen)}
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
            onToggle={() => setAssessOpen(!assessOpen)}
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
            onToggle={() => setProposalOpen(!proposalOpen)}
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

