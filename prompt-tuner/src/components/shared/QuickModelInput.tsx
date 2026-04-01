"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { X, Trash2 } from "lucide-react";
import {
  addToModelHistory,
  searchModelHistory,
  removeFromModelHistory,
  clearModelHistory,
} from "@/lib/utils/model-history";

interface QuickModelInputProps {
  onAdd: (model: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function QuickModelInput({ onAdd, disabled, placeholder, className }: QuickModelInputProps) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updateSuggestions = useCallback((query: string) => {
    const results = searchModelHistory(query);
    setSuggestions(results);
    setSelectedIdx(-1);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    updateSuggestions(v);
    setShowDropdown(true);
  };

  const handleSubmit = (model: string) => {
    const trimmed = model.trim();
    if (!trimmed) return;
    addToModelHistory(trimmed);
    onAdd(trimmed);
    setValue("");
    setSuggestions([]);
    setShowDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
        handleSubmit(suggestions[selectedIdx]);
      } else {
        handleSubmit(value);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  const handleFocus = () => {
    updateSuggestions(value);
    setShowDropdown(true);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleRemoveFromHistory = (model: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeFromModelHistory(model);
    updateSuggestions(value);
  };

  const handleClearHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearModelHistory();
    setSuggestions([]);
  };

  return (
    <div className={`relative ${className || ""}`}>
      <Input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        placeholder={placeholder || "Type model name, press Enter..."}
        className="h-6 text-xs"
        disabled={disabled}
      />
      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden"
        >
          <div className="max-h-40 overflow-y-auto">
            {suggestions.map((model, i) => (
              <div
                key={model}
                onClick={() => handleSubmit(model)}
                className={`flex items-center gap-1.5 px-2 py-1 text-[10px] cursor-pointer ${
                  i === selectedIdx ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <span className="font-mono truncate flex-1 min-w-0">{model}</span>
                <button
                  onClick={(e) => handleRemoveFromHistory(model, e)}
                  className="shrink-0 p-0.5 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
                  title="Remove from history"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
          {suggestions.length > 1 && (
            <button
              onClick={handleClearHistory}
              className="flex items-center gap-1 w-full px-2 py-1 text-[9px] text-muted-foreground/60 hover:text-destructive hover:bg-destructive/5 border-t"
            >
              <Trash2 className="h-2.5 w-2.5" />
              Clear history
            </button>
          )}
        </div>
      )}
    </div>
  );
}
