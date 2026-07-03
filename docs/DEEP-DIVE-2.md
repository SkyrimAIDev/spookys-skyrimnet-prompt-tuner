# Deep Dive II — The Live Preview Pipeline &amp; Copycat

The *engine room* — how a scene becomes a multi-NPC conversation — and **Copycat**,
which teaches one model to talk like another. Companion to
[`DEEP-DIVE.md`](./DEEP-DIVE.md) (Benchmark &amp; Auto Tuner). Traced from the source
in `prompt-tuner/src/lib/pipeline/`, `prompt-tuner/src/lib/copycat/`, and the
`render-*` routes.

**Diagram legend:**

| Marker | Meaning |
|---|---|
| `[agent]` | A **game model call** via that SkyrimNet agent (`default`, `meta_eval`, `action_eval`, `game_master`). Each is really two hops — see below. |
| `[reference]` / `[target]` | Copycat's two models — the voice you're copying vs. the one you're tuning. |
| `[copycat]` / `[tuner]` | The judge/proposer models (Copycat uses the pricey `copycat`/Opus slot; the summary uses `tuner`). |
| `( )` | **No model call** — a render, parse, or file write. |

> **Every "model step" is two hops.** Nothing renders on the model's side. First the
> **server** turns templates into messages (`POST /api/prompts/render-*`, no model),
> then the **client** sends those to the model (`sendLlmRequest → POST /api/llm/chat`).
> In the graphs, a `render-* → infer` line marks the two hops.

---

## Live Preview — the shared engine

Live Preview is the interactive face of the pipeline that **Benchmark, Auto Tuner,
and Copycat all reuse**. You set a scene — player, place, weather, time, which NPCs
are present — and every message you send runs a small orchestra of model calls to
decide who's being addressed, what the NPC says, whether an action fires, and who'd
speak next.

### A single send, with two or more NPCs present

```
   ( ) SCENE SETUP
       player · location / weather / time · NPCs present ·
       chat history · mode · active prompt set
                    │
                    ▼
   ( )  1. Add your message                              (pure logic)
                    │
                    ▼
   [meta_eval]   2. Target selection    — only if > 1 NPC
                    "who is the player actually talking to?"
                    render-target-selector → infer
                    │
                    ▼
   [default]     3. Dialogue            — the NPC's reply (streamed)
                    render-dialogue → infer          ← the one you came for
                    │
                    ▼
   [action_eval] 4. Action selection    — only if actions eligible
                    does an action fire?  parses "ACTION: X"
                    render-action-selector → infer
                    │
                    ▼
   [meta_eval]   5. Speaker prediction  — only if > 1 NPC
                    "who'd speak next?"  DIAGNOSTIC ONLY — fills the
                    analysis panel; does NOT auto-continue the scene
                    render-speaker-selector → infer
                    │
                    ▼
   ( ) ANALYSIS PANEL — logs every call above with its agent, model,
       rendered prompt, messages, response, tokens, and latency
```

A `≥2-NPC send is ~4 model calls across 3 agents`. With a single NPC, steps 2 and 5
are skipped — it's just render → dialogue (→ action).

### Inside a single render

What turns your scene into `messages` — the same assembler every feature depends on:

```
   scene + NPCs + chat history
              │
              ▼
   build simulation state
     NPCs are ENRICHED — skills, gear, factions, spells, gold — all
     fabricated from a NAME-SEEDED RNG. Clock is fixed (Middas, 4E 201).
     Chat history → structured events.
              │
              ▼
   Inja render + ~120 decorator functions
     the SkyrimNet .prompt template runs, calling ~120 functions that
     EMULATE the game's C++ engine so conditionals resolve cleanly.
     Character bios load here, lazily.
              │
              ▼
   cleanup → parse sections
     strip empty blocks, then split on [ system ] / [ user ] /
     [ assistant ] markers into role-tagged messages
              │
              ▼
   messages[]  → ready to infer
```

### Four ways to drive it

| Mode | Who drives it | Calls per turn / tick |
|---|---|---|
| **Single-send** | You, one turn per Enter — the sequence above. | the 4-call sequence |
| **Multichat** | You. Step 3 fans the *same* rendered prompt to N models in parallel; action + speaker run once on the active one. | `N + 3` |
| **Autochat** | A model *plays the player* every 15s (`tuner` agent), then runs the full downstream pipeline. | `~5` |
| **Game Master** | An autonomous director makes NPCs talk to each other on a timer; continuous mode plans a scene first, then advances beats. | `2–6` |

### Calls per turn, by scenario

| Scenario | Calls | Order |
|---|:--:|---|
| Single-send, **1 NPC**, actions on | 2 | dialogue(`default`) → action(`action_eval`) |
| Single-send, 1 NPC, no actions | 1 | dialogue |
| Single-send, **≥2 NPCs**, actions on | 4 | target(`meta_eval`) → dialogue(`default`) → action(`action_eval`) → speaker(`meta_eval`) |
| Multichat, **N models**, ≥2 NPCs | N + 3 | target → N× dialogue (parallel) → action → speaker |
| Game Master, continuous tick | up to 6 | 3× (gm-action → dialogue) |

> **The whole world is fabricated.** There's no running game — NPC stats,
> inventories, factions, quests, line-of-sight, and distances are all invented
> (deterministically, from the NPC's name) so the real SkyrimNet templates render as
> they would in-game. Same name → same stats, every time. This is also why a fix in
> the pipeline propagates to Benchmark, Auto Tuner, and Copycat at once.

---

## Copycat

Copycat is the Auto Tuner's twin, pointed at a different goal. Instead of grading one
model against a quality rubric, it runs a scenario through **two** models — a
**reference** whose voice you love and a **target** you want to sound like it — then
iteratively nudges the *target's* inference settings until its **style** matches:
vocabulary, sentence rhythm, emotional register, response length.

### The loop

```
   ( ) SETUP
       reference model · target model · a dialogue scenario ·
       starting settings (neutral, or from a profile) · max rounds (5)
                    │
                    ▼
   [reference]  Reference dialogue   — ROUND 1 ONLY, then FROZEN
                run the scenario through the reference model once;
                rounds 2+ reuse this frozen output as the target to match
                    │
                    ▼
  ┌── ROUND — up to Max Rounds (default 5) ──────────────────────────────┐
  │                                                                      │
  │  [target]    1. Target dialogue    run the same scenario with the    │
  │                                    current working settings          │
  │                   │                                                  │
  │                   ▼                                                  │
  │  [copycat]   2. Compare + Propose   ONE call · Opus slot             │
  │  (Opus)         scores STYLE match 0–100, writes the comparison,     │
  │                 and proposes settings (+ optional prompt) changes    │
  │                 and a stop flag — all at once                        │
  │                   │                                                  │
  │                   ▼                                                  │
  │             score ≥ 85 or stop_tuning? ─── yes ───►  leave the loop  │
  │                   │ no                                               │
  │                   ▼                                                  │
  │  ( )         3. Apply   settings → target's working baseline         │
  │                         (greedy, in memory) · prompts → temp set     │
  │                   │                                                  │
  │                   └──────────►  ↺ next round  (settings carried)     │
  └──────────────────────────────────────────────────────────────────────┘
                    │  (after the loop)
                    ▼
   [tuner] Session summary → Report
           save the tuned settings to a profile, or discard.
           Nothing is auto-applied.
```

> **Only the target moves.** The reference runs once and is frozen; in round 1 both
> models even use the *same* settings, so any difference you see is purely the models'
> native styles. Copycat then bends the target's settings toward the reference. Like
> the Auto Tuner it's **greedy** — every change is applied and carried forward, never
> reverted, with no "keep the best round."

### Copycat vs. the Auto Tuner

Same skeleton (round loop, temp set, greedy apply, prompt-editing modes, post-run
chat), different goal:

| | Auto Tuner | Copycat |
|---|---|---|
| **Models** | one (the agent's) | two — reference + target |
| **Goal** | higher *absolute quality* vs a rubric | closer *style match* to the reference (0–100) |
| **Judge calls / round** | 2 (assess + propose) | 1 (merged compare + propose) |
| **Judge slot** | `tuner` (Sonnet) | `copycat` (**Opus** — pricier) |
| **Reverts?** | no — greedy | no — greedy |

Cost: `round 1 ≈ (N reference + N target) turns + 1 Opus`; `rounds 2+ ≈ N target + 1
Opus` (the reference only runs once). The Opus compare-and-propose call is the
per-round cost driver, plus one `tuner` summary call at the end.

---

## Four features, one engine

Everything traces back to the same **render → infer** core:

```
                 ┌───────────────────────────────────────┐
                 │   render-dialogue & friends → model    │
                 │   (the shared assembler + inference)   │
                 └───────────────────┬───────────────────┘
                          ▲   driven by   ▲
        ┌─────────────────┴──┬───────────┴───┬──────────────────┐
   Live Preview         Benchmark        Auto Tuner          Copycat
   one interactive      many models,     one model, many     target vs frozen
   turn                 once             rounds vs a judge    reference, many rounds
```

Which is why a fix in the pipeline shows up everywhere at once — and why
understanding this one turn is most of understanding the whole tool.
