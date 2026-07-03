# Deep Dive — Benchmark &amp; Auto Tuner

How the tool's two measurement engines actually work under the hood — the exact
call sequence, the loops, and where your money goes. Traced from the source in
`prompt-tuner/src/lib/benchmark/` and `prompt-tuner/src/lib/autotuner/`.

**Diagram legend** (used in both workflow graphs below):

|   Marker  |                                     Meaning                                                                  |
|-----------|--------------------------------------------------------------------------------------------------------------|
| `[MODEL]` | A call to the **model under test** (the one you're benchmarking / tuning).                                   |
| `[TUNER]` | A call to the **Tuner** — a *separate, fixed* model that acts as judge and proposer (default Claude Sonnet). |
|   `( )`   | **No model call** — a render, parse, or file write.                                                          |

The single most important thing to internalize: the **Tuner is not one of the
models you're testing**. It's a fixed slot you configure once in Settings, and
the quality of every grade you see depends on it.

---

## Benchmark

Benchmark is a **comparison harness**. You choose *one* SkyrimNet agent and a
scenario, then throw several models at the **identical rendered prompt** and see
who does it best — on quality, speed, and token cost. A separate judge model
reads all the answers and ranks them.

You compare models by selecting multiple **profiles**, or by typing ad-hoc
**quick models** (each borrows your active profile's settings and just swaps the
model name). One run = one *category*, which maps to exactly one agent slot and
its one or two subtasks.

### The run, end to end

```
                 ┌───────────────────────────────────────────────┐
                 │  SETUP                                        │
                 │  N models (profiles + quick models) ·         │
                 │  one category (= one agent) · scenario ·      │
                 │  a prompt set                                 │
                 └───────────────────────┬───────────────────────┘
                                         ▼
   ┌─ for each SUBTASK · sequential ──────────────────────────────────┐
   │                                                                  │
   │   ( ) Render the prompt ONCE — shared by every model (fair test) │
   │                          │                                       │
   │                          ▼                                       │
   │   ┌─ for each MODEL · parallel ──────────────────────────────┐   │
   │   │  [MODEL]  1. Response           — latency + tokens       │   │
   │   │                  │                                       │   │
   │   │                  ▼                                       │   │
   │   │  [MODEL]  2. Self-explanation   — feeds "Self-Awareness" │   │
   │   └──────────────────────────────────────────────────────────┘   │
   └───────────────────────────────┬──────────────────────────────────┘
                                   ▼
            [TUNER]  Judge — grade ALL models together
                     6 dimensions, 1–10, ranked markdown report
                     (a fixed model, NOT one being compared)
                                   │
                                   ▼
            ( )  Output — side-by-side model columns
                 (answer · self-explanation · latency · tokens)
                 + a metrics table + the judge's assessment (.md export)
```

### The loop nesting flips depending on the scenario

This is the one genuinely confusing bit, and it's worth knowing:

- **Standard path** (most categories) — subtasks are the *outer* loop; models run
  in parallel inside. The prompt is rendered **once** and shared, so every model
  sees exactly the same thing.
- **Dialogue path** (multi-turn) — models are the *outer* loop; turns run in
  sequence inside. The prompt is **re-rendered every turn**, because each model
  builds up its own branching conversation.

### What it costs

Every answer is **two** model calls (response + self-explanation), and each run
adds **one** judge call:

```
calls ≈ models × subtasks(or turns) × 2  +  1 judge
```

So 3 models over a 2-subtask category ≈ **13 calls**. Multi-turn multiplies by
the number of turns. The self-explanation and the auto-judge both fire on
*every* completed run — easy extra cost to forget.

> **Gotcha:** a slot only ever uses the *first* model in its comma-separated
> list — Benchmark never rotates. To compare five models, make five profiles (or
> quick models), not one profile with five names.

---

## Auto Tuner

Where Benchmark compares many models *once*, the Auto Tuner improves **one**
agent *over many rounds*. It's a **greedy hill-climb driven by an LLM**: run the
task, grade it, propose changes to settings and/or prompts, apply them, and go
again — using the fixed **Tuner** model as both judge and proposer.

### Before you start — what you're allowed to change

| Setting | Options / default | What it controls |
|---|---|---|
| **Tuning target** | `settings` · `prompts` · `both` — default `settings` | Whether the Tuner may touch inference settings, prompt files, or both. |
| **Prompt editing mode** | `recommended` (default) · `world_settings` · `new_prompt` · `auto` · `custom` | When prompts are in scope, which files may be edited. `recommended` = only the agent's key files. |
| **Max rounds** | default `5`, capped at `20` | The primary stop condition — the loop's hard bound. |
| **Locked settings** | 5 locked by default | Out of the box only `temperature`, `topP`, `topK`, and the two penalties are tunable. |

There is **no numeric target and no score threshold** — "better" is judged
qualitatively against previous rounds.

### One round, and the loop

```
   ( ) SETUP + baseline snapshot
       working settings = the profile's current settings
       empty temp prompt set (__tuner_temp__) for any prompt edits
                    │
                    ▼
  ┌── ROUND — repeats up to Max Rounds (default 5) ──────────────────────┐
  │                                                                      │
  │   [MODEL] 1. Benchmark         run the agent with current settings   │
  │                  │                                                   │
  │                  ▼                                                   │
  │   [MODEL] 2. Self-explanation  same model reflects (not scored)      │
  │                  │                                                   │
  │                  ▼                                                   │
  │   [TUNER] 3. Assess            score 1–10 vs ALL previous rounds     │
  │                  │                                                   │
  │                  ▼                                                   │
  │   [TUNER] 4. Propose           JSON: settings_changes,               │
  │                  │             prompt_changes, stop_tuning flag      │
  │                  ▼                                                   │
  │             stop_tuning? ──── yes ────►  leave the loop              │
  │                  │ no                                                │
  │                  ▼                                                   │
  │   ( )     5. Apply   settings → in-memory working baseline           │
  │                      prompts  → temp set on disk (path-checked)      │
  │                  │                                                   │
  │                  └──────────► ↺ next round                          │
  │                               (changes KEPT — greedy, never reverts) │
  └──────────────────────────────────────────────────────────────────────┘
                    │  (after the loop ends)
                    ▼
   [TUNER] Session summary   synthesize the whole run
                    │
                    ▼
   ( ) Report — YOU choose what to keep:
       save settings → profile · save prompts → named set ·
       export .md report · or discard.   Nothing is auto-applied.
       Plus an interactive "Ask the Tuner" chat for further tweaks.
```

> **It's greedy, and it never reverts.** Every proposal is applied and becomes
> the new baseline — even if the *next* round scores worse. There's no "keep the
> best candidate" search; convergence relies entirely on the Tuner reading its
> own round history and choosing not to repeat what failed.

### Three things that trip people up

1. **Two different models are in play.** The agent you're tuning runs steps 1–2;
   the separate **Tuner** model runs steps 3–4 (and the summary and the chat).
   Tuning your agent's settings does nothing to the judge — configure the Tuner
   slot in Settings.
2. **Nothing touches your real profile or prompts during the run.** Settings live
   in memory; prompt edits live in a throwaway temp set. Your live config changes
   only when you click **Save** in the report. Close without saving and nothing
   happened.
3. **The stop conditions are limited.** The loop ends at Max Rounds, when the
   Tuner decides to stop, or when you abort — there's *no* score threshold and
   *no* token/cost budget. Per round you pay ≈ `benchmark + explain + assess +
   propose` (plus up to 2 redirect retries), then one summary call at the end.

---

## How the two fit together

- **Benchmark — breadth.** Many models, one task, once. Answers *"which model
  should I use for this agent?"*
- **Auto Tuner — depth.** One model, one task, many rounds. Answers *"how do I
  make this model better at this agent?"*

Both lean on the same fixed **Tuner** model as their judge — so the quality of
every grade you see depends on how you've configured that one slot, not on the
models being tested.
