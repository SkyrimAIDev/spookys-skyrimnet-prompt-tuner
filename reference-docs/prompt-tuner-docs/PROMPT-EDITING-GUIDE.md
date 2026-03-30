# SkyrimNet Prompt Editing Guide

> Where to edit, what to change, and what to leave alone.
> Compiled from original prompts analysis, SkyrimNet GitHub docs, and the official documentation site.

---

## Critical Rule: Add, Don't Modify

The official SkyrimNet documentation states:

> *"Custom prompt files outside of the `/characters/` folder and the world settings file may be overwritten by updates."*

This means the **intended extension model** is:

1. **Add new numbered submodule files** (e.g., `0600_custom.prompt`) rather than editing existing ones
2. The only files explicitly designed for direct user editing are **`0010_setting.prompt`** and **character `.prompt` files**
3. All other modifications are "unsupported customizations" that need re-applying after SkyrimNet updates

**The Prompt Tuner creates edited prompt sets** that are separate from the originals, so update overwrites don't apply. But the tuner should still prefer **adding new files over modifying existing ones** when possible, since it preserves the original author's carefully tested instructions.

---

## File Editability Ratings

**SAFE** = Mostly plain-text instructions, easy to edit without breaking anything
**CAUTION** = Mix of template logic and text, edit the prose portions only
**DANGEROUS** = Heavy Inja template logic, do not edit
**STRUCTURAL** = Defines the assembly pipeline, never edit

---

## The Dialogue Pipeline (agent: "default")

### Assembly Order

```
[SYSTEM MESSAGE]
  dialogue_response.prompt                    STRUCTURAL — identity line + render calls
    -> submodules/system_head/:
      0010_instructions.prompt                CAUTION — task description per render_mode
      0010_setting.prompt                     SAFE — world setting (USER CUSTOMIZATION POINT)
      [0015_custom.prompt]                    (GAP — new file slot)
      0020_format_rules.prompt                CAUTION — loads guidelines + length rules
        -> submodules/guidelines/:
          0500_roleplay_guidelines.prompt     SAFE — core roleplay behavior
          [0600_custom.prompt]                (GAP — new file slot for writing quality)
          [0700_custom.prompt]                (GAP — new file slot)
          0900_response_format.prompt         SAFE — output format, narration rules
      0100_actor_bios.prompt                  DANGEROUS — pure template
      0200_scene_context.prompt               DANGEROUS — pure template
      0250_omnisight.prompt                   DANGEROUS — visual descriptions
      0400_speech_style_bio.prompt            DANGEROUS — pure template

[EVENT HISTORY]
  components/event_history.prompt             DANGEROUS — pure template (113 lines)

[USER MESSAGE]
  submodules/user_final_instructions/:
    0150_environmental_awareness.prompt       CAUTION — single conditional
    0200_combat_status.prompt                 DANGEROUS — stat injection
    [0300-0600_custom.prompt]                 (GAP — new file slot)
    0650_audio_tags.prompt                    DANGEROUS — TTS logic
    0700_extra_instructions.prompt            CAUTION — narration toggle
    0750_embedded_actions.prompt              CAUTION — action system
    0800_direct_narration.prompt              DANGEROUS — 3 lines
    8000_recent_state_changes.prompt          DANGEROUS — pure state tracking
```

---

## Decision Matrix: What to Edit Where

### Dialogue Agent (default)

| Goal | Best Location | Action |
|------|--------------|--------|
| Improve roleplay depth, character authenticity | `guidelines/0500_roleplay_guidelines.prompt` | Edit existing prose |
| Add writing quality / prose craft rules | **Create `guidelines/0600_writing_quality.prompt`** | New file |
| Add new behavioral rules | **Create `guidelines/0650_custom.prompt`** | New file |
| Change response length limits | `system_head/0020_format_rules.prompt` | Edit length numbers |
| Change narration frequency / rules | `guidelines/0900_response_format.prompt` | Edit existing prose |
| Change dialogue format (asterisks, etc.) | `guidelines/0900_response_format.prompt` | Edit existing prose |
| Add world-building, tone, atmosphere | `system_head/0010_setting.prompt` | Edit (mostly empty) |
| Add universal behavioral modifiers | **Create `system_head/0015_custom.prompt`** | New file |
| Add final-turn reminders | **Create `user_final_instructions/0500_custom.prompt`** | New file |
| Change task framing | `system_head/0010_instructions.prompt` | Edit with care (branching) |

### Standalone Agents

| Agent | Primary Edit Target | Notes |
|-------|-------------------|-------|
| Game Master (scene direction) | `gamemaster_action_selector.prompt` — Style section (lines ~117-122) | Self-contained. Careful with continuous mode branches |
| Game Master (planning) | `gamemaster_scene_planner.prompt` — planning guidelines | Mostly plain text. Preserve JSON format |
| Action Selection | `native_action_selector.prompt` — selection criteria | Has JSON vs text conditional format |
| Memory Generation | `memory/generate_memory.prompt` — content/style guidelines | Mostly plain text. Preserve JSON format |
| Diary | `diary_entry.prompt` — 10 numbered guidelines | Mostly plain text. Uses full system_head |
| Bio Update | `dynamic_bio_update.prompt` — update philosophy & block defs | Mostly plain text. Preserve JSON format |
| Target/Speaker Selection | `target_selectors/*.prompt` — selection criteria | Mix of template and criteria |
| Profile Generation | `helpers/generate_profile.prompt` — block guidelines | Mostly plain text |

### Cross-Agent

| Goal | File | Agents Affected |
|------|------|----------------|
| World setting / tone | `system_head/0010_setting.prompt` | dialogue, diary, memory gen, bio update, profile gen |
| Roleplay behavior | `guidelines/0500_roleplay_guidelines.prompt` | dialogue, diary |
| Response format | `guidelines/0900_response_format.prompt` | dialogue, diary |

---

## Recommended New File Slots

### 1. `submodules/guidelines/0600_writing_quality.prompt`

**The biggest gap in the current prompt set.** The existing guidelines cover:
- Character embodiment (0500) — *how to be the character*
- Output format (0900) — *structure and formatting rules*

But nothing covers **prose craft** — vocabulary richness, sentence variety, conversational naturalism, subtext, emotional depth in the writing itself. This is the #1 thing users want to improve.

**Example content for this slot:**
```
## Writing Quality
Write with texture and specificity. Avoid generic filler phrases.
- Replace vague words with concrete ones: "nice" → "sturdy", "bad" → "bitter"
- Vary sentence rhythm: mix short punches with longer flowing thoughts
- Show emotion through word choice and pacing, not labels ("angry", "sad")
- Ground dialogue in sensory details from the scene when natural
```

### 2. `submodules/user_final_instructions/0400_custom.prompt`

Final-turn instructions appear just before "Respond in character now." This is a high-impact position — the last thing the LLM reads before generating. Good for:
- Quality reminders ("Stay in character. No meta-commentary.")
- Style emphasis ("Keep it natural and grounded.")
- Anti-patterns ("Don't repeat the question back before answering.")

### 3. `submodules/system_head/0015_custom.prompt`

Between the task description (0010) and format rules (0020). Good for:
- Universal behavioral modifiers that should come before detailed rules
- Global tone settings that aren't world-building (those go in 0010_setting)
- Custom role framing

---

## Files the Tuner Should NEVER Edit

These files are template-heavy scaffolding. Editing them risks breaking the prompt pipeline:

| File | Why |
|------|-----|
| `dialogue_response.prompt` | Pure structural template — calls render_subcomponent |
| `player_dialogue.prompt` | Complex branching (trigger/transform/idle) |
| `player_thoughts.prompt` | Complex branching (forced/combat/book/event/general) |
| `system_head/0100_actor_bios.prompt` | 2 lines of pure template calls |
| `system_head/0200_scene_context.prompt` | 4 lines of pure template calls |
| `system_head/0250_omnisight.prompt` | Conditional OmniSight display |
| `system_head/0400_speech_style_bio.prompt` | 3 lines of pure template calls |
| `components/event_history*.prompt` | Complex event formatting logic |
| `user_final_instructions/0200_combat_status.prompt` | Stat ratio calculations |
| `user_final_instructions/0650_audio_tags.prompt` | Complex TTS branching |
| `user_final_instructions/0800_direct_narration.prompt` | 3-line conditional |
| `user_final_instructions/8000_recent_state_changes.prompt` | Pure state tracking |
| `warmup.prompt` | Cache utility, output discarded |
| All `character_bio/*.prompt` files | Block stubs + template logic |
| All `components/context/*.prompt` files | Scene assembly templates |

---

## Detailed File Descriptions

### Primary Edit Targets

#### `submodules/system_head/0010_setting.prompt`
- **Currently**: Nearly empty — just `# Setting` with a comment
- **Purpose**: World-building, tone, atmosphere. The official user customization point
- **Affects**: ALL agents that use system_head (dialogue, diary) and standalone agents that include it (memory gen, bio update, profile gen)
- **Good for**: "This is a dark, gritty Skyrim where...", universal tone instructions
- **Keep concise**: 50-150 words max. This is included in every prompt

#### `submodules/guidelines/0500_roleplay_guidelines.prompt`
- **Currently**: 9 lines. Core embodiment instruction + combat branch
- **Key content**: "Embody {name} fully. Draw from your character profile..."
- **Good for**: Roleplay depth, character authenticity, emotional reactivity, conversational naturalism
- **Bad for**: Format rules, length rules, narration rules (those go in 0900)

#### `submodules/guidelines/0900_response_format.prompt`
- **Currently**: 42 lines. Complex branching by render_mode and features
- **Key content**: Narration rules ("1 in 4 responses"), asterisk rules, thoughts format, combat format
- **Good for**: Output structure, narration frequency, repetition avoidance, action vs narration
- **Caution**: Has multiple conditional branches — edit the prose within branches, don't restructure

#### `system_head/0020_format_rules.prompt`
- **Currently**: 27 lines. Loads guidelines + length constraints
- **Key tuning targets**: Length numbers: "8-40 words typical, 60 words maximum" (normal), "14 words" (combat), "8-30 words" (thoughts), "8-45 words" (transform)
- **Good for**: Response verbosity changes
- **Caution**: The `render_subcomponent("guidelines")` call must be preserved

#### `diary_entry.prompt`
- **Currently**: ~134 lines, mostly plain text
- **Key content**: 10 numbered guidelines for diary quality, emotional depth, scene expansion
- **Good for**: Diary writing style, emotional depth, transitions, physical grounding
- **Note**: Length target (`targetEntryLength`) is a template variable. JSON format at end is critical

#### `memory/generate_memory.prompt`
- **Currently**: ~126 lines, mostly plain text
- **Key content**: "Be CONCISE but SPECIFIC" philosophy, importance scoring, tag guidelines
- **Good for**: Memory quality, content guidelines, style examples
- **Note**: JSON format must be preserved

#### `dynamic_bio_update.prompt`
- **Currently**: ~258 lines, mostly plain text
- **Key content**: "95% should be MINIMAL or NO CHANGE" philosophy, block definitions, pruning strategies
- **Good for**: Update conservatism, block length targets, pruning rules
- **Note**: JSON output format and block name references must be preserved

#### `gamemaster_scene_planner.prompt`
- **Currently**: ~122 lines, mostly plain text
- **Good for**: Beat types, planning guidelines, player independence rules
- **Note**: "Heavily favor dialogue" instruction, JSON format must be preserved

#### `gamemaster_action_selector.prompt`
- **Currently**: ~167 lines
- **Key editable section**: Style section (lines ~117-122)
- **Caution**: Complex conditional branches for continuous mode and scene plans

---

## Identified Gaps

### 1. No Writing Quality / Prose Craft File
The existing guidelines cover character embodiment (0500) and output format (0900), but nothing addresses the *craft* of the writing: vocabulary, sentence variety, conversational naturalism, subtext. **Recommendation: Create `guidelines/0600_writing_quality.prompt`**

### 2. No Per-NPC-Type Conditional Guidelines
All NPCs get identical guidelines. There's no mechanism for "guards should be terse" or "bards should be poetic." The only differentiation comes from character bio content. A new guideline file could use decorators like `is_in_faction()` to conditionally adjust behavior.

### 3. No Cross-Agent Universal Rules
Each standalone agent has its own instructions. The setting file (0010_setting) is the only shared file, but it's designed for world-building. A new `system_head/0015_universal.prompt` could hold rules that should affect all agents using system_head.

### 4. No Per-Scene Style Overrides
There's no "in dungeons, be terse" or "during romantic scenes, be lyrical." The render_mode system only distinguishes full/transform/thoughts/book, not scene types. A new `user_final_instructions` file could use scene context decorators to inject conditional style guidance.

---

## Sources

- [SkyrimNet-GamePlugin GitHub](https://github.com/MinLL/SkyrimNet-GamePlugin)
- [SkyrimNet Documentation Site](https://goncalo22.github.io/SkyrimNet-GamePlugin/)
- [SkyrimNet Modding Docs — WORKFLOW_PROMPTS.md](https://github.com/MinLL/SkyrimNet-GamePlugin/tree/main/docs/modding)
- [SkyrimNet Modding Docs — WORKFLOW_MOD_INTEGRATION.md](https://github.com/MinLL/SkyrimNet-GamePlugin/tree/main/docs/modding)
- Original prompts at `reference-docs/original-prompts/`
- `reference-docs/SKYRIMNET-ARCHITECTURE.md`
