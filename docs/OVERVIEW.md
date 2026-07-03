# Documentation

Guides and internals for **Spooky's SkyrimNet Prompt Tuner**.

## Start here

- **[QUICKSTART.md](./QUICKSTART.md)** — first-run setup (API key → model → Live
  Preview), the *originals → prompt set → exported mod* flow, a tour of all seven
  tools, and the export-to-MO2 steps.

## Deep dives — how the engines actually work

Traced from the source: the exact call sequences, loops, and cost, each with
end-to-end workflow graphs.

| Doc | Covers |
|---|---|
| **[DEEP-DIVE.md](./DEEP-DIVE.md)** | **Benchmark** (comparison harness) & **Auto Tuner** (the greedy tuning loop) |
| **[DEEP-DIVE-2.md](./DEEP-DIVE-2.md)** | The **Live Preview pipeline** — the shared engine every feature reuses — & **Copycat** |
| **[DEEP-DIVE-3.md](./DEEP-DIVE-3.md)** | **Multichat** & the **trigger / event system** |
| **[DEEP-DIVE-4.md](./DEEP-DIVE-4.md)** | The **Inja template engine** & editor, the **prompt-set / MO2 export** flow, and the **Actions** system |

If you only read one, read **DEEP-DIVE-2** — the Live Preview pipeline is the
engine the other three features drive, so understanding one turn is most of
understanding the whole tool.

## Building

- **[../BUILD.md](../BUILD.md)** — building and packaging the desktop app.
