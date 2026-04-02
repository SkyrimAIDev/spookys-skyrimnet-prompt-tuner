import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { ORIGINAL_PROMPTS_DIR, EDITED_PROMPTS_DIR, MO2_PROMPTS_SUBPATH, isPathAllowed } from "@/lib/files/paths";
import { resolvePromptSetBaseServer } from "@/lib/files/paths-server";

/**
 * POST /api/export/combine-sets
 * Body: {
 *   targetName: string,
 *   sources: { setName: string, priority: number }[],
 *   conflictResolutions?: Record<string, string>  // relativePath → setName
 * }
 * Combines multiple prompt sets into a new one.
 * Sources are applied in priority order (lowest first, highest overwrites).
 * Manual conflict resolutions override priority for specific files.
 */
export async function POST(request: Request) {
  try {
    const { targetName, sources, conflictResolutions = {} } = await request.json();

    if (!targetName || typeof targetName !== "string") {
      return NextResponse.json({ error: "Missing target name" }, { status: 400 });
    }
    if (!Array.isArray(sources) || sources.length < 2) {
      return NextResponse.json({ error: "Select at least 2 source sets" }, { status: 400 });
    }

    const safeName = targetName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const targetDir = path.join(EDITED_PROMPTS_DIR, safeName);

    if (!isPathAllowed(targetDir)) {
      return NextResponse.json({ error: "Path not allowed" }, { status: 403 });
    }

    // Check if target already exists
    try {
      await fs.access(targetDir);
      return NextResponse.json({ error: `Set "${safeName}" already exists` }, { status: 409 });
    } catch { /* Good, doesn't exist */ }

    // Create target with MO2 layout
    const targetPrompts = path.join(targetDir, MO2_PROMPTS_SUBPATH);
    await fs.mkdir(targetPrompts, { recursive: true });

    // Sort sources by priority (lowest first so highest overwrites)
    const sorted = [...sources].sort((a, b) => a.priority - b.priority);

    // Build a map of manual resolutions for quick lookup
    const manualPicks = new Map(Object.entries(conflictResolutions));

    let filesCopied = 0;
    let conflictsResolved = 0;
    const copiedFiles = new Set<string>();

    // Copy files from each source in priority order
    for (const source of sorted) {
      const basePath = source.setName === "__original__"
        ? ORIGINAL_PROMPTS_DIR
        : resolvePromptSetBaseServer(source.setName);

      if (!isPathAllowed(basePath)) continue;

      const files = await listFilesRecursive(basePath, "");

      for (const relPath of files) {
        // Check manual resolution — if this file has a manual pick and it's not this set, skip
        const manualPick = manualPicks.get(relPath);
        if (manualPick && manualPick !== source.setName) {
          continue;
        }

        // If file was already copied by a higher priority set (later in sorted order),
        // only overwrite if this is a higher priority set OR it has a manual pick
        const isConflict = copiedFiles.has(relPath);

        const srcPath = path.join(basePath, relPath);
        const destPath = path.join(targetPrompts, relPath);

        // Ensure parent directory exists
        await fs.mkdir(path.dirname(destPath), { recursive: true });

        try {
          await fs.copyFile(srcPath, destPath);
          if (isConflict) conflictsResolved++;
          copiedFiles.add(relPath);
          filesCopied++;
        } catch {
          // Skip files that can't be read
        }
      }
    }

    return NextResponse.json({
      success: true,
      name: safeName,
      filesCopied,
      conflictsResolved,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to combine sets: ${(error as Error).message}` },
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
    // Directory doesn't exist
  }

  return results;
}
