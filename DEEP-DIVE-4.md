# Deep Dive IV — Authoring, Packaging &amp; Actions

The last three layers: the **template engine** you write prompts in, how edits
become an **installable mod**, and the **actions** NPCs can take — including the
trap that quietly splits them in two. Companion to [`DEEP-DIVE.md`](./DEEP-DIVE.md),
[`DEEP-DIVE-2.md`](./DEEP-DIVE-2.md), and [`DEEP-DIVE-3.md`](./DEEP-DIVE-3.md).
Traced from `lib/inja/`, `lib/export/`, `lib/actions/`, and the `api/export/*` routes.

> This describes current `main`-branch behavior. (The `security-hardening` branch
> adds render step-budget/range caps to the engine; those aren't reflected here.)

---

## ① Inja — the language your prompts are written in

Every SkyrimNet `.prompt` file is a template in **Inja**, a Jinja-like language.
The app ships its own TypeScript reimplementation to render them. It's a faithful
*subset* — knowing where it diverges saves real debugging.

### Source to string, in three passes

```
   .prompt source text
          │  tokenize
          ▼
   Tokens        {{ }} expressions · {% %} control · {# #} comments · text
          │  parse
          ▼
   AST           if · for · set · block · expression
                 (expressions: vars, dot/bracket, calls, math, comparisons, `in`)
          │  render(ast, RenderContext)      ◄── variables + character blocks
          ▼                                       + ~120 decorator functions
   rendered string  → split into [ system ] / [ user ] / [ assistant ] messages
```

The **render context** is where the world plugs in: `variables`, character
`{% block %}` overrides, and ~120 `functions` (the "decorators") that emulate the
game's C++ engine so conditionals resolve.

> **The gotcha that bites everyone: there are no `|` filters.** The pipe syntax
> isn't parsed, even though the built-ins exist. Write `upper(name)`, not
> `name | upper`. (Object *methods* like `x.foo()` also parse but silently return
> nothing.)

### Divergences from "real" Inja

| You might expect | Here |
|---|---|
| `value \| filter` | not parsed — call `filter(value)` instead |
| `{{- trim -}}` whitespace control | not recognized |
| `obj.method()` | parses, but always yields nothing |
| `{% set x = 1 %}` is loop-scoped | at top level / in `if` it *leaks* to the outer scope; only `for` isolates it |
| built-in functions | 21 of them — `length, join, lower, upper, replace, default, first, last, range, capitalize, has_key…` — usable as functions *or* filter-style |

### The editor around it

A CodeMirror editor with a hand-written highlighter for Inja tags and SkyrimNet's
`[ system ]` / `[ user ]` section markers. Practical things to know:

- **Originals are locked** — read-only; Save is disabled until the file lives in a set.
- **The eye toggle** renders the template server-side against a stub scene (empty
  NPCs, Whiterun) so you see real output — there's no inline per-variable preview.
- **The diff view** compares your current buffer against the saved original.
- **Token count is a rough `length / 4` estimate**, not a real tokenizer — ballpark only.
- **YAML files** (triggers/actions) get a live validation badge; `.prompt`
  templates get highlighting but no schema check.

---

## ② Prompt sets &amp; the MO2 export

A **prompt set** is a named folder of *just the files you changed* — an overlay.
Unchanged files fall through to the read-only originals at render time, so a set is
small and safe. Exporting turns it into a zip already shaped like a Mod Organizer 2
mod.

### The flow

```
   Edit a file IN A SET
     (originals are read-only → "copy to set" to fork one in first;
      there is no auto-fork on edit)
          │
          ▼
   Save Prompt Set
     names your overlay · saving "from originals" makes an EMPTY set
     (edits become overrides on top of the originals)
          │
          ▼
   Package  (server)
     walks your set, diffs each file against the original, and returns
     ONLY the changed + new files as a JSON manifest (identical files dropped)
          │
          ▼
   Zip  (in your browser, via JSZip)
     lays files out as  SKSE/Plugins/SkyrimNet/prompts/…   (+ any config/…)
          │
          ▼
   Download → drop into MO2
     a pure overlay mod; enable it and let it win over the base prompts
```

- **Your edits live outside the app and survive updates** — sets are stored in
  `data/edited-prompts/` next to the exe, separate from the bundled originals.
- **Switching the "active set" only changes what's *read*** — it never moves files.
  The active set governs reads/renders; the editor still writes to each file's own path.
- **Combining sets** physically copies files into a *new* set, resolved by priority
  (lower in the list wins); conflict detection shows which files overlap first.

> **"Update Originals" is the one destructive button.** It replaces the entire
> bundled originals directory from a SkyrimNet release archive (`rm` + rename, no
> backup). Your edited sets are untouched — they just start overlaying the new
> originals.

---

## ③ The Actions system

Actions are things an NPC can do besides talking — trade, follow, attack, gesture.
An *action-selection* model call decides whether one fires each turn. Simple —
except "custom actions" secretly means **two entirely separate systems that never
talk to each other.**

```
   ┌──────────────────────────────┐        ┌──────────────────────────────┐
   │  A · IN-APP REGISTRY         │        │  B · DISK YAML FILE          │
   ├──────────────────────────────┤        ├──────────────────────────────┤
   │  "Add Custom Action" form    │        │  "New Custom Action" dialog  │
   │           ▼                  │        │           ▼                  │
   │  stored in localStorage      │        │  written to                  │
   │  (an ActionDefinition)       │        │  config/actions/*.yaml       │
   │           ▼                  │        │           ▼                  │
   │  enters the tool's dialogue  │        │  folded into the MO2 export  │
   │  & action-selector prompts   │        │  for the real game           │
   │                              │        │                              │
   │  ✓ drives the tool           │        │  ✓ ships to the game         │
   │  ✗ NOT exported              │        │  ✗ NOT in the tool           │
   └──────────────────────────────┘        └──────────────────────────────┘
                    └──────────── ✗ never connected ───────────┘
```

> **The trap:** an action you make with "New Custom Action" (the YAML dialog) will
> *not* appear in your action list or any preview — and one you add in the Action
> Manager will *not* be in your exported mod. To both test *and* ship one, you
> currently have to create it in both places.

### How an action reaches the model (in-tool)

```
   Eligible actions          the registry, filtered by a simple on/off toggle
     (registry)              — no distance/faction/state gating
          │
          ▼
   Action-selector render    native_action_selector.prompt — eligible actions
     (+ optional dialogue)   are embedded in the prompt
          │
          ▼
   [action_eval]  the model picks one
          │
          ▼
   Parse "ACTION: X" → record it
     a bare regex grabs the action NAME (params dropped); a [Action: X] entry
     joins the transcript. "None" = nothing fires.
```

**Game Master mode uses a different, richer path** — its own hardcoded action set
(StartConversation / ContinueConversation / Narrate) and a smarter parser that
*does* keep JSON parameters.

---

*Part IV of the Deep Dive — the final headline subsystems. Together with parts
I–III this covers the whole tool, engine to export.*
