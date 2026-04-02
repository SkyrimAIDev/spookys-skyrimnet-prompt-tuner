"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useConfigStore } from "@/stores/configStore";
import { useFileStore } from "@/stores/fileStore";
import { useAppStore } from "@/stores/appStore";
import { sendLlmRequest } from "@/lib/llm/client";
import { TUNER_SYSTEM_PROMPT } from "@/lib/tuner/system-prompt";
import { EditorPanel } from "@/components/editor/EditorPanel";
import type { ChatMessage } from "@/types/llm";
import {
  Send,
  Loader2,
  Trash2,
  Square,
  Bot,
  User,
  FileText,
  X,
  GripVertical,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";

import { parseToolCalls, stripToolCallXml, type ToolCall } from "@/lib/llm/tool-parser";

interface TunerMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCall[];
}

function buildFileContext(openFiles: { name: string; displayName: string; content: string; path: string }[]): string {
  if (openFiles.length === 0) return "";
  const blocks = openFiles.map(
    (f) => `--- File: ${f.displayName || f.name} ---\nPath: ${f.path}\n${f.content}`
  );
  return `\n\nThe following files are currently open in the editor. Use them as context when answering:\n\n${blocks.join("\n\n")}`;
}

// stripToolCallXml imported from @/lib/llm/tool-parser

export function TunerChat() {
  const [messages, setMessages] = useState<TunerMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [chatWidth, setChatWidth] = useState(480);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startWidth: chatWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - ev.clientX;
      setChatWidth(Math.max(300, Math.min(800, dragRef.current.startWidth + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [chatWidth]);
  const globalApiKey = useConfigStore((s) => s.globalApiKey);

  const openFiles = useFileStore((s) => s.openFiles);
  const closeFile = useFileStore((s) => s.closeFile);
  const hasOpenFiles = openFiles.length > 0;

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]');
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages, streamingText]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isProcessing) return;
    const userMessage = input.trim();
    setInput("");

    const userMsg: TunerMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: userMessage,
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);
    setStreamingText("");

    const MAX_ITERATIONS = 8;

    try {
      const fileContext = buildFileContext(openFiles);
      const systemContent = TUNER_SYSTEM_PROMPT + fileContext;

      let currentMessages: ChatMessage[] = [
        { role: "system", content: systemContent },
        ...messages.map(
          (m): ChatMessage => ({
            role: m.role === "system" ? "assistant" : m.role,
            content: m.content,
          })
        ),
        { role: "user", content: userMessage },
      ];

      const abortController = new AbortController();
      abortRef.current = abortController;

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        setStreamingText("");

        const log = await sendLlmRequest({
          messages: currentMessages,
          agent: "tuner",
          onChunk: (chunk) => setStreamingText((prev) => prev + chunk),
          signal: abortController.signal,
        });

        const response = log.response || "";
        setStreamingText("");

        if (log.error) {
          setMessages((prev) => [
            ...prev,
            { id: `${Date.now()}-error`, role: "system", content: `Error: ${log.error}` },
          ]);
          break;
        }

        const toolCalls = parseToolCalls(response);

        if (toolCalls.length === 0) {
          // No tool calls — final response
          setMessages((prev) => [
            ...prev,
            { id: `${Date.now()}-assistant`, role: "assistant", content: response },
          ]);
          break;
        }

        // Execute tool calls and collect results
        const toolResults: string[] = [];
        for (const call of toolCalls) {
          try {
            call.result = await executeToolCall(call.name, call.args, openFiles);
            toolResults.push(`[Tool: ${call.name}]\n${call.result}`);
          } catch (e) {
            call.result = `Error: ${(e as Error).message}`;
            toolResults.push(`[Tool: ${call.name}]\nError: ${(e as Error).message}`);
          }
        }

        // Show the assistant's text + tool calls in the UI
        const displayContent = stripToolCallXml(response);
        if (displayContent) {
          setMessages((prev) => [
            ...prev,
            { id: `${Date.now()}-assistant-${iteration}`, role: "assistant", content: displayContent, toolCalls },
          ]);
        } else {
          // Even if no display text, track the tool calls
          setMessages((prev) => [
            ...prev,
            { id: `${Date.now()}-tools-${iteration}`, role: "assistant", content: `(executing ${toolCalls.map(c => c.name).join(", ")}...)`, toolCalls },
          ]);
        }

        // Feed results back to LLM for next iteration
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: response },
          { role: "user", content: toolResults.join("\n\n") },
        ];

        // If last iteration, the agent ran out of turns
        if (iteration === MAX_ITERATIONS - 1) {
          setMessages((prev) => [
            ...prev,
            { id: `${Date.now()}-limit`, role: "system", content: "Reached maximum tool iterations." },
          ]);
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { id: `${Date.now()}-error`, role: "system", content: `Error: ${(error as Error).message}` },
        ]);
      }
    } finally {
      setIsProcessing(false);
      abortRef.current = null;
    }
  }, [input, isProcessing, messages, openFiles]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsProcessing(false);
    setStreamingText("");
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
    setStreamingText("");
  }, []);

  const hasApiKey = !!globalApiKey;

  const chatPanel = (
    <div className="flex flex-col h-full w-full min-w-0">
        {/* Open files context bar */}
        {hasOpenFiles && (
          <div className="border-b px-2 py-1 flex items-center gap-1 flex-wrap bg-muted/30">
            <span className="text-[10px] text-muted-foreground shrink-0">Context:</span>
            {openFiles.map((f) => (
              <div
                key={f.path}
                className="flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary max-w-[160px]"
              >
                <FileText className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{f.displayName || f.name}</span>
                <button
                  onClick={() => closeFile(f.path)}
                  className="ml-0.5 shrink-0 opacity-50 hover:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <ScrollArea ref={scrollAreaRef} className="flex-1 overflow-hidden">
          <div className="p-3 space-y-3 min-w-0 overflow-hidden">
            {messages.length === 0 && !streamingText && (
              <div className="text-center text-xs text-muted-foreground py-8 space-y-2">
                <Bot className="h-8 w-8 mx-auto opacity-20" />
                <p>SkyrimNet Tuner Agent</p>
                <p className="text-[10px] max-w-xs mx-auto">
                  {hasApiKey
                    ? "Ask me to enhance speech styles, create character bios, explain prompt architecture, or suggest improvements. Open files from the explorer to give me context."
                    : "Configure an API key in Settings to start."}
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <TunerBubble key={msg.id} message={msg} />
            ))}

            {streamingText && (
              <TunerBubble
                message={{ id: "streaming", role: "assistant", content: streamingText }}
              />
            )}
          </div>
        </ScrollArea>

        <div className="border-t p-2">
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleClear}
              disabled={isProcessing}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={hasApiKey ? "Ask the tuner agent..." : "Set API key in Settings first"}
              disabled={!hasApiKey || isProcessing}
              className="h-8 text-xs"
            />
            {isProcessing ? (
              <Button variant="destructive" size="icon" className="h-8 w-8 shrink-0" onClick={handleStop}>
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={handleSend}
                disabled={!input.trim() || !hasApiKey}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
    </div>
  );

  if (!hasOpenFiles) {
    return <div className="flex h-full min-w-0 overflow-hidden">{chatPanel}</div>;
  }

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* Editor fills remaining space */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <EditorPanel />
      </div>

      {/* Drag handle — matches ResizableHandle style */}
      <div
        onMouseDown={handleDragStart}
        className="relative flex w-px shrink-0 cursor-col-resize items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2"
      >
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-sm border">
          <GripVertical className="size-2.5" />
        </div>
      </div>

      {/* Chat panel — fixed width, resizable via drag */}
      <div style={{ width: chatWidth }} className="shrink-0 flex flex-col min-w-0 overflow-hidden border-l">
        {chatPanel}
      </div>
    </div>
  );
}

function ToolCallBlock({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Build the full copyable text: args + result
  const fullText = [
    ...Object.entries(call.args).map(([k, v]) => `${k}=${v}`),
    ...(call.result ? [call.result] : []),
  ].join("\n");

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Collapsed preview: show truncated args
  const argPreview = Object.entries(call.args)
    .filter(([k]) => k !== "content")
    .map(([k, v]) => `${k}=${v.length > 60 ? v.substring(0, 60) + "…" : v}`)
    .join(" ");

  return (
    <div className="rounded bg-background/50 text-[10px] overflow-hidden">
      <div
        className="flex items-center gap-1 p-1.5 cursor-pointer hover:bg-background/80 transition-colors select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <FileText className="h-3 w-3 shrink-0" />
        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
          {call.name}
        </Badge>
        {!expanded && (
          <span className="font-mono text-muted-foreground truncate">{argPreview}</span>
        )}
        <button
          onClick={handleCopy}
          className="ml-auto shrink-0 p-0.5 rounded hover:bg-muted transition-colors"
          title="Copy to clipboard"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border/30 px-1.5 pb-1.5">
          {Object.entries(call.args).map(([k, v]) => (
            <div key={k} className="mt-1">
              <span className="text-[9px] font-medium text-muted-foreground">{k}=</span>
              <pre className="text-[9px] text-muted-foreground whitespace-pre-wrap break-all ml-2">
                {v}
              </pre>
            </div>
          ))}
          {call.result && (
            <pre className="mt-1 pt-1 border-t border-border/20 text-[9px] text-muted-foreground whitespace-pre-wrap break-all max-h-60 overflow-auto">
              {call.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function TunerBubble({ message }: { message: TunerMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="text-center text-[10px] text-destructive py-0.5">
        {message.content}
      </div>
    );
  }

  return (
    <div className={`flex gap-2 min-w-0 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="shrink-0 h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div
        className={`max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-xs overflow-hidden ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        <div className="whitespace-pre-wrap break-words overflow-hidden">{message.content}</div>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
            {message.toolCalls.map((call, i) => (
              <ToolCallBlock key={i} call={call} />
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <div className="shrink-0 h-6 w-6 rounded-full bg-primary flex items-center justify-center">
          <User className="h-3.5 w-3.5 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}

// parseToolCalls imported from @/lib/llm/tool-parser

/**
 * Resolve a file path for writing. Handles:
 * 1. Relative paths (e.g. "characters/foo.prompt") → resolved against active prompt set
 * 2. Paths in the original prompts dir → remapped to the active prompt set
 * 3. Active set is "originals" (empty) → returns error telling LLM to ask user to select a set
 */
async function resolveWritablePath(filePath: string): Promise<string> {
  // Already an absolute path in edited-prompts? Pass through.
  if (/[/\\]edited-prompts[/\\]/.test(filePath)) return filePath;

  const activeSet = useAppStore.getState().activePromptSet;

  // If no edited prompt set is active, auto-create one
  let setName = activeSet;
  if (!setName) {
    // Create a new prompt set named "Chat Edits" (or "Chat Edits 2", etc.)
    let newName = "Chat Edits";
    const listRes = await fetch("/api/export/list-sets");
    if (listRes.ok) {
      const { sets } = await listRes.json();
      const existing = new Set((sets || []).map((s: string) => s.toLowerCase()));
      let counter = 1;
      while (existing.has(newName.toLowerCase())) {
        counter++;
        newName = `Chat Edits ${counter}`;
      }
    }
    // Create the set
    const createRes = await fetch("/api/export/save-set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({ error: "unknown" }));
      return `Error: Failed to create prompt set "${newName}": ${errData.error}. Please create one manually using 'Save Prompt Set' in the top toolbar.`;
    }
    // The API sanitizes the name (spaces → underscores), use the sanitized version
    const createData = await createRes.json();
    const sanitizedName = createData.name || newName;
    // Switch the app to use this new set
    useAppStore.getState().setActivePromptSet(sanitizedName);
    setName = sanitizedName;
  }

  // Resolve the active set's base path
  const resolveRes = await fetch(`/api/files/resolve-prompt-set?name=${encodeURIComponent(setName)}`);
  if (!resolveRes.ok) return `Error: Could not resolve prompt set "${setName}"`;
  const { basePath } = await resolveRes.json();

  // If the path is relative (no drive letter / no leading slash), resolve against the prompt set
  const isAbsolute = /^[A-Za-z]:/.test(filePath) || filePath.startsWith("/");
  if (!isAbsolute) {
    return `${basePath}/${filePath}`.replace(/\\/g, "/");
  }

  // If the path points to original prompts, remap to the active set
  if (/[/\\]original[_-]prompts?[/\\]/.test(filePath) || /[/\\]reference-docs[/\\]/.test(filePath)) {
    // Extract the relative portion after the prompts root
    const match = filePath.match(/[/\\](?:original[_-]prompts?|prompts)[/\\](.*)/);
    if (match) {
      return `${basePath}/${match[1]}`.replace(/\\/g, "/");
    }
  }

  return filePath;
}

async function executeToolCall(
  name: string,
  args: Record<string, string>,
  openFiles: { path: string }[]
): Promise<string> {
  switch (name) {
    case "read_file": {
      const filePath = args.path || args.file_path || "";
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath.trim())}`);
      const data = await res.json();
      return data.content ?? data.error ?? "File not found";
    }
    case "write_file": {
      let filePath = (args.path || args.file_path || "").trim();
      const content = args.content ?? "";
      // Resolve relative paths against the active prompt set
      filePath = await resolveWritablePath(filePath);
      if (filePath.startsWith("Error:")) return filePath;
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, content }),
      });
      const data = await res.json();
      if (!res.ok) return `Error: ${data.error}`;
      // Sync back to open editor tab if this file is open
      const store = useFileStore.getState();
      if (openFiles.some((f) => f.path === filePath)) {
        store.updateFileContent(filePath, content);
        store.markFileSaved(filePath);
      }
      store.refreshTree();
      return `File written successfully to: ${filePath}`;
    }
    case "edit_file": {
      let filePath = (args.path || args.file_path || "").trim();
      // Resolve relative paths against the active prompt set
      filePath = await resolveWritablePath(filePath);
      if (filePath.startsWith("Error:")) return filePath;
      const oldStr = args.old_str ?? "";
      const newStr = args.new_str ?? "";
      // Read current content
      const readRes = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const readData = await readRes.json();
      if (!readRes.ok) return `Error reading file: ${readData.error}`;
      const currentContent: string = readData.content;

      let newContent: string | null = null;
      let matchMethod = "";

      if (currentContent.includes(oldStr)) {
        // Exact match
        newContent = currentContent.replace(oldStr, newStr);
        matchMethod = "exact";
      } else {
        // Fallback 1: flexible whitespace — split into tokens, match with \s+
        const tokens = oldStr.split(/\s+/).filter(Boolean);
        if (tokens.length > 0) {
          const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
          const flexRegex = new RegExp(pattern, "s");
          if (flexRegex.test(currentContent)) {
            newContent = currentContent.replace(flexRegex, newStr);
            matchMethod = "flexible whitespace";
          }
        }

        // Fallback 2: trimmed line matching — trim each line and compare
        if (newContent === null) {
          const oldLines = oldStr.split("\n").map((l) => l.trim()).filter(Boolean);
          if (oldLines.length >= 2) {
            const contentLines = currentContent.split("\n");
            // Find a window of content lines whose trimmed versions match
            for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
              let match = true;
              for (let j = 0; j < oldLines.length; j++) {
                if (contentLines[i + j].trim() !== oldLines[j]) {
                  match = false;
                  break;
                }
              }
              if (match) {
                const before = contentLines.slice(0, i);
                const after = contentLines.slice(i + oldLines.length);
                newContent = [...before, newStr, ...after].join("\n");
                matchMethod = "trimmed line";
                break;
              }
            }
          }
        }
      }

      if (newContent === null) {
        return `Error: Search string not found in file. The old_str text doesn't match the file content — check whitespace, line breaks, and special characters. Try using read_file first to see the exact content.`;
      }

      const writeRes = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, content: newContent }),
      });
      const writeData = await writeRes.json();
      if (!writeRes.ok) return `Error: ${writeData.error}`;
      const store = useFileStore.getState();
      if (openFiles.some((f) => f.path === filePath)) {
        store.updateFileContent(filePath, newContent);
        store.markFileSaved(filePath);
      }
      store.refreshTree();
      return `Edit applied successfully${matchMethod !== "exact" ? ` (matched via ${matchMethod})` : ""}`;
    }
    case "search_characters": {
      const query = args.query || args.name || Object.values(args)[0] || "";
      const activeSet = useAppStore.getState().activePromptSet;
      const res = await fetch(`/api/files/search?q=${encodeURIComponent(query.trim())}&type=characters&activeSet=${encodeURIComponent(activeSet)}`);
      const data = await res.json();
      return (data.results || [])
        .map((r: { displayName?: string; name: string; path?: string }) =>
          `${r.displayName || r.name}: ${r.path || ""}`
        )
        .join("\n");
    }
    case "list_prompts": {
      const subdir = args.directory || args.path || "";
      const activeSet = useAppStore.getState().activePromptSet;
      // Resolve the active prompt set base path
      const resolveRes = await fetch(`/api/files/resolve-prompt-set?name=${encodeURIComponent(activeSet)}`);
      if (!resolveRes.ok) return "Error: Could not resolve prompt set path";
      const { basePath } = await resolveRes.json();
      const targetDir = subdir ? `${basePath}/${subdir}`.replace(/\\/g, "/") : basePath;

      // Recursive listing helper (up to 2 levels deep for manageable output)
      type Child = { name: string; path: string; type: string };
      const listDir = async (dir: string): Promise<Child[]> => {
        const res = await fetch(`/api/files/children?path=${encodeURIComponent(dir)}&limit=200`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.nodes || data.children || []) as Child[];
      };

      const topLevel = await listDir(targetDir);
      const lines: string[] = [`Prompt set: ${activeSet || "Original Prompts"}`, `Base path: ${basePath}`, ""];

      for (const item of topLevel) {
        if (item.type === "directory") {
          lines.push(`${item.name}/`);
          // List one level deeper for directories
          const subItems = await listDir(item.path);
          for (const sub of subItems) {
            if (sub.type === "directory") {
              lines.push(`  ${sub.name}/  (directory — use list_prompts with directory="${subdir ? subdir + "/" : ""}${item.name}/${sub.name}" to explore)`);
            } else {
              lines.push(`  ${sub.name}  →  ${sub.path}`);
            }
          }
        } else {
          lines.push(`${item.name}  →  ${item.path}`);
        }
      }

      return lines.join("\n") || "No files found in this directory";
    }
    case "search_prompts": {
      const query = args.query || Object.values(args)[0] || "";
      const activeSet = useAppStore.getState().activePromptSet;
      const res = await fetch(`/api/files/search?q=${encodeURIComponent(query.trim())}&activeSet=${encodeURIComponent(activeSet)}`);
      const data = await res.json();
      return (data.results || [])
        .map((r: { displayName?: string; name: string; path?: string }) =>
          `${r.displayName || r.name}: ${r.path || ""}`
        )
        .join("\n") || "No files found";
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
