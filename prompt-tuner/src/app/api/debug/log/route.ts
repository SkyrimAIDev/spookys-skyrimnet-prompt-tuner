import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { EDITED_PROMPTS_DIR } from "@/lib/files/paths";

/**
 * POST /api/debug/log
 * Body: { tag: string, data: unknown }
 *
 * Appends a JSON line to {editedPromptsDir}/tuner-debug.log so testers can
 * ship the file back when reporting issues. Lives inside edited-prompts/ so
 * isPathAllowed permits the reveal-in-explorer shortcut.
 *
 * GET /api/debug/log → returns the resolved log path so the UI can show it.
 */
const LOG_PATH = path.join(EDITED_PROMPTS_DIR, "tuner-debug.log");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      tag: body.tag || "log",
      data: body.data ?? null,
    }) + "\n";
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.appendFile(LOG_PATH, line, "utf-8");
    return NextResponse.json({ ok: true, path: LOG_PATH });
  } catch (error) {
    return NextResponse.json(
      { error: `Debug log write failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Make sure the file exists so `explorer /select,...` can highlight it.
  try {
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.access(LOG_PATH).catch(async () => {
      await fs.writeFile(LOG_PATH, "", "utf-8");
    });
  } catch { /* best-effort */ }
  return NextResponse.json({ path: LOG_PATH });
}
