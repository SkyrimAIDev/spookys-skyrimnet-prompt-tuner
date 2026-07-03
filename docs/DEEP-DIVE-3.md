# Deep Dive III — Multichat &amp; the Trigger System

Comparing models *live, mid-conversation* — and how simulated game **events**
quietly steer what your NPCs say next. Companion to [`DEEP-DIVE.md`](./DEEP-DIVE.md)
(Benchmark &amp; Auto Tuner) and [`DEEP-DIVE-2.md`](./DEEP-DIVE-2.md) (Live Preview
pipeline &amp; Copycat). Traced from `prompt-tuner/src/lib/triggers/`,
`components/chat/`, and `lib/pipeline/build-sim-state.ts`.

**Diagram legend:** `[Model]` = a model call · `( )` = no model call (render,
match, or write).

---

## Multichat — many models, one live conversation

Multichat isn't a separate screen — it's a switch on the Live Preview chat. When
it's on, the **dialogue step** (and *only* the dialogue step) fans out: the same
rendered prompt goes to every model you've selected, in parallel, and you read
their replies side by side. Everything else in the turn still runs **once**.

### A Multichat send

```
   ( ) SELECTED MODELS
       any mix of saved profiles (their dialogue-slot model)
       + ad-hoc quick models · no hard cap
                    │
                    ▼
   ( )  1. Add your message  ·  target selection (once, if > 1 NPC)
                    │
                    ▼
   ( )  2. Render the dialogue prompt          ONCE · shared by all N
                    │                          (the fair-test guarantee)
                    ▼
  ┌── FAN-OUT · all N models · parallel (Promise.all) ─────────────────┐
  │   [Model 1]          [Model 2]        ···        [Model N]          │
  │   streams to         streams to                  streams to         │
  │   column 1           column 2                    column N           │
  └────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
   ( )  3. Collapse → the PRIMARY reply
          only the active profile's reply (else first success) becomes
          the canonical message; the other N−1 are kept for display only
                    │
                    ▼
   ( )  4. Action + speaker    ONCE, on the primary reply
          (never per-model)
```

> **The conversation collapses to one branch.** N models each write a different
> reply, but only the *primary* one is committed to history and feeds the next
> turn. The others live purely in the side-by-side view — so the ongoing scene
> always follows your active model, no matter how many you're comparing.

### Cost, and "quick models"

`per send ≈ N dialogue calls + up to 3 single calls` (target, action, speaker — on
the active profile). Five models means 5× the dialogue cost every turn, fired all
at once with no throttle.

A **quick model** is just a bare model name you type in. It borrows the active
profile's endpoint, key, and tuning and swaps in that model — a zero-setup way to
drop another contender into the comparison. Names you've used are remembered for
autocomplete.

### Multichat vs. Benchmark

Both compare models on a shared prompt, but they answer different questions:

| | Multichat | Benchmark |
|---|---|---|
| **Feel** | live, interactive, mid-chat | batch run over a fixed scenario |
| **Self-explanation** | none | yes — each model justifies itself |
| **AI judge** | none — you eyeball it | yes — a judge grades &amp; ranks |
| **Conversation** | follows the *primary* only; others are display | each model keeps its *own* diverging thread |
| **Best for** | a quick gut-check while playing | a rigorous, scored comparison |

---

## The Trigger System — events, and how NPCs notice them

SkyrimNet reacts to in-game **events** — a spell cast, a hit landed, a location
entered. This tab lets you *fire a simulated event* and see which **trigger** rules
it matches. Hold two things apart: the **match check** (instant, pure logic) and
the **effect on dialogue** (indirect, on the next render).

### Firing an event — the match check

Every loaded trigger is tested against your event through a short-circuit gate
chain. **No model is called** — it's synchronous, in-browser logic:

```
   FIRE AN EVENT   (pick 1 of 12 types + fill its fields: spell, target, damage…)
          │
          ▼   for each loaded trigger:
   ┌──────────────────────────────────────────────────────┐
   │  event type matches?         ── no ──►  MISS          │
   │         │ yes                                         │
   │         ▼                                             │
   │  all conditions pass?        ── no ──►  MISS          │
   │    equals / contains / regex / gt / lt (case-insens.) │      (shows which
   │         │ yes                                         │       condition failed)
   │         ▼                                             │
   │  off cooldown?               ── no ──►  BLOCKED       │
   │         │ yes                                         │
   │         ▼                                             │
   │  probability roll?           ── no ──►  BLOCKED       │  ← the ONLY randomness
   │         │ yes                                         │
   │         ▼                                             │
   │  ✓ MATCH → render the response template               │
   │    fills {{ event_json.field }} placeholders          │
   └──────────────────────────────────────────────────────┘
          NO MODEL CALL — pure, synchronous, in-browser logic
```

Each trigger reports as one card: **Match** (green), **Blocked** (grey —
cooldown/probability), or **Miss** (red — type/conditions).

### …and how it actually reaches a conversation

Firing a trigger does **not** generate dialogue. It records the event and shows the
rule's static response. NPCs only "notice" it on the *next* dialogue render, when
the event history is folded into the prompt:

```
   fired event ──►  event history
                          │
                          ▼
   building the next sim state converts each event into:
     • a structured "recent event"
     • a "short-lived event"  (human summary, e.g. "Cast Flames at enemy")
                          │
                          ▼
   appears in the next rendered DIALOGUE prompt
     → the NPC's next reply can react to what just happened in the scene
```

### What a trigger rule looks like

A trigger is a small YAML file under `config/triggers/` (an edited set shadows the
original of the same name):

| Field | Purpose |
|---|---|
| `eventType` | which of the 12 event kinds it listens for |
| `conditions` | field predicates the event must satisfy |
| `response` | template rendered on match (`{{ event_json.x }}`) |
| `cooldownSeconds` | min seconds between fires of this event type |
| `probability` | 0–1 random gate |
| `priority` | *declared, but never used by the matcher* |

> **Two gotchas.** *Cooldown counts any event of the type* — even one that didn't
> match this rule's conditions still resets the window. And *probability is the
> only randomness* in the whole system: the same event can match one time and get
> blocked the next.

---

*Part III of the Deep Dive. The trigger match is pure logic; its dialogue effect
flows through the shared render pipeline described in `DEEP-DIVE-2.md`.*
