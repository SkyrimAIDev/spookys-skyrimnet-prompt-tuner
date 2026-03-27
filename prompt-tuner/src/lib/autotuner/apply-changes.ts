import type { AiTuningSettings } from "@/types/config";
import type { SettingsChange, PromptChange } from "@/types/autotuner";

/**
 * Normalize a parameter name from snake_case (LLM output) to camelCase (store keys).
 * e.g. "max_tokens" → "maxTokens", "frequency_penalty" → "frequencyPenalty"
 */
const PARAM_ALIASES: Record<string, keyof AiTuningSettings> = {
  max_tokens: "maxTokens",
  top_p: "topP",
  top_k: "topK",
  frequency_penalty: "frequencyPenalty",
  presence_penalty: "presencePenalty",
  stop_sequences: "stopSequences",
  structured_outputs: "structuredOutputs",
  allow_reasoning: "allowReasoning",
  reasoning_effort: "reasoningEffort",
};

function normalizeParamKey(key: string): keyof AiTuningSettings {
  return PARAM_ALIASES[key] || key as keyof AiTuningSettings;
}

/**
 * Apply settings changes to a copy of the working settings.
 * Returns a new AiTuningSettings object (does not mutate).
 */
export function applySettingsChanges(
  current: AiTuningSettings,
  changes: SettingsChange[],
): AiTuningSettings {
  const result = { ...current };

  for (const change of changes) {
    const key = normalizeParamKey(change.parameter);
    if (!(key in result)) continue;

    const currentVal = result[key];
    let newVal: typeof currentVal;

    if (typeof currentVal === "number") {
      newVal = Number(change.newValue);
      if (isNaN(newVal as number)) continue;
    } else if (typeof currentVal === "boolean") {
      newVal = change.newValue === true || change.newValue === "true";
    } else {
      newVal = String(change.newValue);
    }

    (result as Record<string, unknown>)[key] = newVal;
  }

  return result;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize quote characters: smart/curly quotes → straight quotes,
 * em/en dashes → hyphens, and other common LLM character substitutions.
 */
function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u2039\u203A]/g, "'")  // smart single quotes
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')   // smart double quotes
    .replace(/[\u2013\u2014]/g, "-")                       // em/en dash → hyphen
    .replace(/\u2026/g, "...");                             // ellipsis character
}

/**
 * Build a regex from search text that allows flexible whitespace matching.
 * Splits the text into non-whitespace tokens and joins them with \s+ patterns,
 * so "foo  bar\nbaz" matches "foo bar\n  baz" etc.
 */
function buildFlexibleRegex(searchText: string, caseInsensitive = false): RegExp | null {
  const tokens = searchText.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const pattern = tokens.map(escapeRegex).join("\\s+");
  return new RegExp(pattern, caseInsensitive ? "si" : "s");
}

/**
 * Apply prompt changes by writing modified files via the API.
 * Each change is a search/replace within a file.
 * Tries exact match first, then falls back to flexible whitespace matching.
 *
 * @param changes - The proposed prompt changes to apply.
 * @param sourceSetName - Optional: name of the original source prompt set the temp set
 *   was derived from. When a file doesn't exist in the temp set yet (because the temp
 *   set is now empty by default), it is seeded from this set, falling back to the
 *   original prompts if the source set doesn't have it either.
 *
 * Returns the changes with originalContent and modifiedContent filled in.
 */
export async function applyPromptChanges(
  changes: PromptChange[],
  sourceSetName?: string,
): Promise<PromptChange[]> {
  const applied: PromptChange[] = [];

  for (const change of changes) {
    // Empty searchText = create a new file with replaceText as content
    if (!change.searchText || change.searchText.trim() === "") {
      const writeResp = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: change.filePath, content: change.replaceText }),
      });

      if (!writeResp.ok) {
        throw new Error(`Failed to create ${change.filePath}: HTTP ${writeResp.status}`);
      }

      applied.push({
        ...change,
        originalContent: "",
        modifiedContent: change.replaceText,
      });
      continue;
    }

    // Build the read URL with optional fallbacks so that if the file doesn't exist in
    // the temp set yet, we seed it from the source set (or the original prompts).
    let readUrl = `/api/files/read?path=${encodeURIComponent(change.filePath)}`;
    if (sourceSetName && sourceSetName !== "__tuner_temp__") {
      readUrl += `&fallback=${encodeURIComponent(sourceSetName)}`;
    }
    readUrl += `&fallback=__original__`;

    // Read current content
    const readResp = await fetch(readUrl);
    if (!readResp.ok) {
      // Non-fatal: skip this change
      applied.push({
        ...change,
        originalContent: "",
        modifiedContent: "",
        reason: `[SKIPPED] Failed to read file: HTTP ${readResp.status}. ${change.reason}`,
      });
      continue;
    }
    const { content: originalContent } = await readResp.json();

    // Try matching with multiple fallback strategies
    const matchResult = findSearchMatch(originalContent, change.searchText);

    if (!matchResult) {
      // Non-fatal: skip this change and report it
      applied.push({
        ...change,
        originalContent,
        modifiedContent: "",
        reason: `[SKIPPED] Search text not found — text may have changed since last round. ${change.reason}`,
      });
      continue;
    }

    const modifiedContent = originalContent.substring(0, matchResult.index) +
      change.replaceText +
      originalContent.substring(matchResult.index + matchResult.length);

    // Write modified content
    const writeResp = await fetch("/api/files/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: change.filePath, content: modifiedContent }),
    });

    if (!writeResp.ok) {
      applied.push({
        ...change,
        originalContent,
        modifiedContent: "",
        reason: `[SKIPPED] Failed to write file: HTTP ${writeResp.status}. ${change.reason}`,
      });
      continue;
    }

    applied.push({
      ...change,
      originalContent,
      modifiedContent,
    });
  }

  return applied;
}

/**
 * Try to find the search text in the content using multiple fallback strategies:
 * 1. Exact match
 * 2. Flexible whitespace
 * 3. Normalized quotes + exact
 * 4. Normalized quotes + flexible whitespace
 * 5. Case-insensitive flexible whitespace
 * 6. Normalized + case-insensitive flexible whitespace
 *
 * Returns { index, length } of the match in the ORIGINAL content, or null.
 */
function findSearchMatch(
  content: string,
  searchText: string,
): { index: number; length: number } | null {
  // 1. Exact match
  const exactIdx = content.indexOf(searchText);
  if (exactIdx !== -1) {
    return { index: exactIdx, length: searchText.length };
  }

  // 2. Flexible whitespace
  const flexRegex = buildFlexibleRegex(searchText);
  if (flexRegex) {
    const flexMatch = flexRegex.exec(content);
    if (flexMatch) return { index: flexMatch.index, length: flexMatch[0].length };
  }

  // 3. Normalized quotes — exact
  const normContent = normalizeQuotes(content);
  const normSearch = normalizeQuotes(searchText);
  const normIdx = normContent.indexOf(normSearch);
  if (normIdx !== -1) {
    return { index: normIdx, length: normSearch.length };
  }

  // 4. Normalized quotes — flexible whitespace
  const normFlexRegex = buildFlexibleRegex(normSearch);
  if (normFlexRegex) {
    const normFlexMatch = normFlexRegex.exec(normContent);
    if (normFlexMatch) return { index: normFlexMatch.index, length: normFlexMatch[0].length };
  }

  // 5. Case-insensitive flexible whitespace (on original)
  const ciFlexRegex = buildFlexibleRegex(searchText, true);
  if (ciFlexRegex) {
    const ciMatch = ciFlexRegex.exec(content);
    if (ciMatch) return { index: ciMatch.index, length: ciMatch[0].length };
  }

  // 6. Normalized + case-insensitive flexible whitespace
  const normCiFlexRegex = buildFlexibleRegex(normSearch, true);
  if (normCiFlexRegex) {
    const normCiMatch = normCiFlexRegex.exec(normContent);
    if (normCiMatch) return { index: normCiMatch.index, length: normCiMatch[0].length };
  }

  // 7. Line-anchor matching: find the first distinctive line of search text in the content,
  //    then match a block of the same line count from that position.
  //    This handles cases where the LLM slightly rephrases middle/end lines.
  const searchLines = searchText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (searchLines.length >= 1) {
    const contentLines = content.split("\n");
    // Find the first search line that's distinctive enough (>15 chars, not just punctuation/template)
    const anchorLine = searchLines.find((l) => l.length > 15 && !/^[{%#\s}]+$/.test(l))
      || searchLines[0];
    const anchorNorm = normalizeQuotes(anchorLine.toLowerCase());

    for (let ci = 0; ci < contentLines.length; ci++) {
      const contentLineNorm = normalizeQuotes(contentLines[ci].trim().toLowerCase());
      if (contentLineNorm.includes(anchorNorm) || anchorNorm.includes(contentLineNorm)) {
        // Found anchor — calculate the block range in the original content
        const blockStart = content.indexOf(contentLines[ci]);
        if (blockStart === -1) continue;
        // Take as many lines as the search text had
        const blockEndLine = Math.min(ci + searchLines.length, contentLines.length);
        const blockEnd = contentLines.slice(0, blockEndLine).join("\n").length;
        const blockLength = blockEnd - blockStart;
        if (blockLength > 0) {
          return { index: blockStart, length: blockLength };
        }
      }
    }
  }

  // 8. Containment: if the search text (trimmed) is contained in the content when
  //    we collapse all whitespace to single spaces, match on that.
  const collapsedContent = content.replace(/\s+/g, " ");
  const collapsedSearch = searchText.trim().replace(/\s+/g, " ");
  if (collapsedSearch.length > 20) {
    const collapsedIdx = collapsedContent.toLowerCase().indexOf(collapsedSearch.toLowerCase());
    if (collapsedIdx !== -1) {
      // Map back to the original content position.
      // Find the nth non-whitespace character position in original.
      let origStart = 0;
      let collapsed = 0;
      while (collapsed < collapsedIdx && origStart < content.length) {
        if (/\s/.test(content[origStart]) && /\s/.test(content[origStart - 1] || "")) {
          origStart++;
          continue;
        }
        origStart++;
        collapsed++;
      }
      // Find the end similarly
      let origEnd = origStart;
      let matchLen = 0;
      while (matchLen < collapsedSearch.length && origEnd < content.length) {
        if (/\s/.test(content[origEnd]) && /\s/.test(content[origEnd - 1] || "")) {
          origEnd++;
          continue;
        }
        origEnd++;
        matchLen++;
      }
      return { index: origStart, length: origEnd - origStart };
    }
  }

  return null;
}
