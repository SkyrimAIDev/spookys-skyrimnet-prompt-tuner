import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { isPathAllowed, EDITED_PROMPTS_DIR, ORIGINAL_PROMPTS_DIR, MO2_PROMPTS_SUBPATH } from "@/lib/files/paths";
import { resolvePromptSetBaseServer } from "@/lib/files/paths-server";

/**
 * POST /api/files/copy-to-set
 * Body: { sourcePath: string, targetSetName: string, relativePath?: string }
 * Copies a file into the target prompt set at the same relative path it holds
 * inside the source prompt set (or ORIGINAL_PROMPTS_DIR).
 */
export async function POST(request: NextRequest) {
  try {
    const { sourcePath, targetSetName } = await request.json();

    if (!sourcePath || !targetSetName) {
      return NextResponse.json({ error: "Missing sourcePath or targetSetName" }, { status: 400 });
    }
    if (!isPathAllowed(sourcePath)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const safeName = targetSetName.replace(/[^a-zA-Z0-9._-]/g, "_");

    // Compute relative path from whichever base the source belongs to.
    // Use path.relative so case-insensitive Windows filesystems and mixed
    // separators are handled correctly.
    const resolvedSource = path.resolve(sourcePath);
    // Returns "" when source IS the base (whole-folder copy), null when outside.
    const isUnder = (base: string): string | null => {
      const rel = path.relative(base, resolvedSource);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
      return rel;
    };

    let relativePath: string | null = null;

    const relFromOriginal = isUnder(ORIGINAL_PROMPTS_DIR);
    const relFromEdited = isUnder(EDITED_PROMPTS_DIR);

    if (relFromOriginal !== null) {
      relativePath = relFromOriginal.replace(/\\/g, "/");
    } else if (relFromEdited !== null) {
      // Strip "{setName}/..." prefix variants (legacy "prompts/..." or MO2 "SKSE/...")
      const afterEdited = relFromEdited.replace(/\\/g, "/");
      const slashIdx = afterEdited.indexOf("/");
      if (slashIdx === -1) {
        // Source is the set root itself — copy whole prompts dir
        relativePath = "";
      } else {
        const afterSet = afterEdited.slice(slashIdx + 1);
        const mo2Prefix = MO2_PROMPTS_SUBPATH.replace(/\\/g, "/") + "/";
        if (afterSet.startsWith(mo2Prefix)) {
          relativePath = afterSet.slice(mo2Prefix.length);
        } else if (afterSet.startsWith("prompts/")) {
          relativePath = afterSet.slice("prompts/".length);
        } else {
          relativePath = afterSet;
        }
      }
    }

    if (relativePath === null) {
      return NextResponse.json({ error: "Cannot determine relative path for source file" }, { status: 400 });
    }

    // Resolve target set base; if it doesn't exist yet, use MO2 layout
    const resolved = resolvePromptSetBaseServer(safeName);
    let targetBase: string;
    try {
      await fs.access(resolved);
      targetBase = resolved;
    } catch {
      targetBase = path.join(EDITED_PROMPTS_DIR, safeName, MO2_PROMPTS_SUBPATH);
    }

    const destPath = path.join(targetBase, relativePath);

    if (!isPathAllowed(destPath)) {
      return NextResponse.json({ error: "Access denied for destination" }, { status: 403 });
    }

    // Recursively copy directories, single-file copy otherwise
    const stat = await fs.stat(resolvedSource);
    if (stat.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await fs.cp(resolvedSource, destPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(resolvedSource, destPath);
    }

    return NextResponse.json({ success: true, destPath });
  } catch (error) {
    return NextResponse.json(
      { error: `Copy failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
