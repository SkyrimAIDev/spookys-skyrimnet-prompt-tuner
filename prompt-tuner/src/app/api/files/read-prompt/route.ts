import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { ORIGINAL_PROMPTS_DIR, isPathAllowed } from "@/lib/files/paths";
import { resolvePromptSetBaseServer } from "@/lib/files/paths-server";

/**
 * POST /api/files/read-prompt
 * Body: { relativePath: string, promptSet?: string, fallbackSets?: string[] }
 *
 * Reads a prompt file by relative path, resolving against prompt set bases.
 * Uses the same pattern as FileLoader: try the specified set first, then
 * each fallback in order, then originals as a last resort.
 */
export async function POST(request: Request) {
  try {
    const { relativePath, promptSet, fallbackSets = [] } = await request.json();

    if (!relativePath || typeof relativePath !== "string") {
      return NextResponse.json({ error: "Missing relativePath" }, { status: 400 });
    }

    // Build ordered list of bases to try: primary → fallbacks → originals
    const bases: { name: string; basePath: string }[] = [];

    if (promptSet) {
      try {
        bases.push({ name: promptSet, basePath: resolvePromptSetBaseServer(promptSet) });
      } catch { /* skip */ }
    }

    for (const setName of fallbackSets) {
      if (!setName) continue;
      try {
        const base = setName === "__original__"
          ? ORIGINAL_PROMPTS_DIR
          : resolvePromptSetBaseServer(setName);
        // Avoid duplicates
        if (!bases.some((b) => b.basePath === base)) {
          bases.push({ name: setName, basePath: base });
        }
      } catch { /* skip */ }
    }

    // Always try originals as last resort
    if (!bases.some((b) => b.basePath === ORIGINAL_PROMPTS_DIR)) {
      bases.push({ name: "__original__", basePath: ORIGINAL_PROMPTS_DIR });
    }

    // Try each base in order
    for (const { name, basePath } of bases) {
      const fullPath = path.join(basePath, relativePath);
      if (!isPathAllowed(fullPath)) continue;
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        return NextResponse.json({ content, resolvedFrom: name });
      } catch {
        // Try next base
      }
    }

    return NextResponse.json({ error: "File not found in any prompt set" }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to read prompt: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
