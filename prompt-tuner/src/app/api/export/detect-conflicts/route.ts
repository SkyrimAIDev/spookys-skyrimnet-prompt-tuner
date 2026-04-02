import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { ORIGINAL_PROMPTS_DIR, isPathAllowed } from "@/lib/files/paths";
import { resolvePromptSetBaseServer } from "@/lib/files/paths-server";

/**
 * POST /api/export/detect-conflicts
 * Body: { setNames: string[] }
 * Scans selected prompt sets and finds files that exist in multiple sets.
 */
export async function POST(request: Request) {
  try {
    const { setNames } = await request.json();

    if (!Array.isArray(setNames) || setNames.length < 2) {
      return NextResponse.json({ error: "Select at least 2 sets" }, { status: 400 });
    }

    // For each set, recursively list all files and build a map: relativePath → setName[]
    const fileMap = new Map<string, string[]>();
    let totalFiles = 0;

    for (const setName of setNames) {
      const basePath = setName === "__original__"
        ? ORIGINAL_PROMPTS_DIR
        : resolvePromptSetBaseServer(setName);

      if (!isPathAllowed(basePath)) continue;

      const files = await listFilesRecursive(basePath, "");
      for (const relPath of files) {
        totalFiles++;
        if (!fileMap.has(relPath)) fileMap.set(relPath, []);
        fileMap.get(relPath)!.push(setName);
      }
    }

    // Filter to conflicts (files that exist in 2+ sets)
    const conflicts: { relativePath: string; existsIn: string[] }[] = [];
    for (const [relPath, sets] of fileMap) {
      if (sets.length > 1) {
        conflicts.push({ relativePath: relPath, existsIn: sets });
      }
    }

    conflicts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    return NextResponse.json({ conflicts, totalFiles });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to detect conflicts: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}

async function listFilesRecursive(basePath: string, relDir: string): Promise<string[]> {
  const results: string[] = [];
  const fullDir = path.join(basePath, relDir);

  try {
    const entries = await fs.readdir(fullDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...await listFilesRecursive(basePath, relPath));
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }
  } catch {
    // Directory doesn't exist in this set — normal
  }

  return results;
}
