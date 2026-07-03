import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { EDITED_PROMPTS_DIR, ORIGINAL_PROMPTS_DIR } from "@/lib/files/paths";
import { validateActionYaml } from "@/lib/yaml/validator";
import type { CustomActionYaml } from "@/types/yaml-configs";

/**
 * List custom-action YAML files (config/actions) for a prompt set — the disk
 * half of the actions system. The edited set shadows originals by name.
 * GET ?promptSet=name
 */
export async function GET(request: NextRequest) {
  try {
    const rawPromptSet = request.nextUrl.searchParams.get("promptSet") || "";
    // Confine to a single set dir — no path traversal.
    const promptSet = rawPromptSet.replace(/[^a-zA-Z0-9._-]/g, "_");
    const actions: CustomActionYaml[] = [];

    const readDir = async (dir: string) => {
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        return; // directory doesn't exist — fine
      }
      for (const file of files) {
        if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
        try {
          const content = await fs.readFile(path.join(dir, file), "utf-8");
          const result = validateActionYaml(content);
          if (result.valid && result.parsed) {
            // Edited set is read first, so it wins on name collisions.
            if (!actions.some((a) => a.name === result.parsed!.name)) {
              actions.push(result.parsed);
            }
          }
        } catch {
          // Skip unreadable/invalid files
        }
      }
    };

    if (promptSet) {
      await readDir(path.join(EDITED_PROMPTS_DIR, promptSet, "config", "actions"));
    }
    await readDir(path.join(ORIGINAL_PROMPTS_DIR, "config", "actions"));

    return NextResponse.json({ actions });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to list actions: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
