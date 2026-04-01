"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Copy-to-clipboard button that shows a checkmark on success.
 * Use inside a `group/...` container for hover-to-reveal.
 */
export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={`text-muted-foreground hover:text-foreground transition-opacity ${className}`}
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
