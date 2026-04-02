import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { isPathAllowed, isReadOnly, ORIGINAL_PROMPTS_DIR, EDITED_PROMPTS_DIR } from "@/lib/files/paths";
import { resolvePromptSetBaseServer } from "@/lib/files/paths-server";

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  // Optional: when the file doesn't exist at filePath, fall back through these
  // prompt set names in order (e.g. the user's selected set, then "__original__").
  const fallbackSets = request.nextUrl.searchParams.getAll("fallback");

  if (!filePath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  if (!isPathAllowed(filePath)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return NextResponse.json({ content, isReadOnly: isReadOnly(filePath) });
  } catch (primaryErr) {
    if ((primaryErr as NodeJS.ErrnoException).code !== "ENOENT" || fallbackSets.length === 0) {
      const code = (primaryErr as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      console.error("Failed to read file:", primaryErr);
      return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
    }
  }

  // File not found in primary path — try fallback sets.
  // Compute the relative path by stripping any known prompt-set base prefix.
  // We try each fallback set in order, resolving the same relative path within it.
  const normalizedFilePath = filePath.replace(/\\/g, "/");

  // Try to extract the relative prompt path by stripping known base paths.
  // We try temp set, edited-prompts sets, and originals — whichever matches.
  let relativePath: string | null = null;

  const candidateBases = [
    resolvePromptSetBaseServer("__tuner_temp__"),
    ORIGINAL_PROMPTS_DIR,
  ];
  // Also try each fallback set as a potential base to strip
  for (const setName of fallbackSets) {
    if (setName && setName !== "__original__") {
      try { candidateBases.push(resolvePromptSetBaseServer(setName)); } catch {}
    }
  }
  // Try the edited-prompts root with various subdirectory patterns
  const editedBase = EDITED_PROMPTS_DIR.replace(/\\/g, "/");

  for (const base of candidateBases) {
    const normalizedBase = base.replace(/\\/g, "/").replace(/\/$/, "");
    if (normalizedFilePath.startsWith(normalizedBase + "/")) {
      relativePath = normalizedFilePath.slice(normalizedBase.length + 1);
      break;
    }
  }

  // Last resort: try to extract relative path from edited-prompts root
  // (handles any set name in the path: edited-prompts/{setName}/SKSE/.../prompts/{relative})
  if (!relativePath && normalizedFilePath.includes(editedBase)) {
    const afterEdited = normalizedFilePath.slice(normalizedFilePath.indexOf(editedBase) + editedBase.length + 1);
    // Strip set name and MO2 path: {setName}/SKSE/Plugins/SkyrimNet/prompts/{relative}
    const mo2Marker = "/SKSE/Plugins/SkyrimNet/prompts/";
    const mo2Idx = afterEdited.indexOf(mo2Marker.slice(1)); // without leading /
    if (mo2Idx !== -1) {
      relativePath = afterEdited.slice(mo2Idx + mo2Marker.length - 1);
    }
    // Also try legacy: {setName}/prompts/{relative}
    if (!relativePath) {
      const legacyMarker = "/prompts/";
      const legacyIdx = afterEdited.indexOf(legacyMarker.slice(1));
      if (legacyIdx !== -1) {
        relativePath = afterEdited.slice(legacyIdx + legacyMarker.length - 1);
      }
    }
  }

  if (!relativePath) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  for (const setName of fallbackSets) {
    const base = setName === "__original__"
      ? ORIGINAL_PROMPTS_DIR
      : resolvePromptSetBaseServer(setName);
    const candidatePath = path.join(base, relativePath);
    if (!isPathAllowed(candidatePath)) continue;
    try {
      const content = await fs.readFile(candidatePath, "utf-8");
      return NextResponse.json({ content, isReadOnly: isReadOnly(candidatePath) });
    } catch {
      // try next fallback
    }
  }

  return NextResponse.json({ error: "File not found" }, { status: 404 });
}
