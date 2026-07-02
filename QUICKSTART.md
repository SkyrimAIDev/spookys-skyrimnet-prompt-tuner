# Quickstart — Spooky's SkyrimNet Prompt Tuner

Find the best model and settings for your AI NPCs — and rewrite their prompts — without ever launching the game.

A desktop workshop for [SkyrimNet](https://www.nexusmods.com/skyrimspecialedition/mods/136172), the AI-driven NPC dialogue system for Skyrim SE/AE. Run full conversations, benchmark models head-to-head, and export your edits as a ready-to-install mod.

---

## Your first five minutes

1. **Add an API key.** Open **Settings** (the gear icon) and paste a key for any OpenAI-compatible provider — OpenRouter, OpenAI, DeepSeek, xAI, or a local server like LM Studio or Ollama. The prompt editor works offline; chat, preview, and benchmarking need a key.
2. **Point a model at each slot.** Still in Settings, assign a model to the agent slots — or just set one global model to start. Each *agent* is a different kind of call SkyrimNet makes (dialogue, action choice, memory, and so on), and each can run its own model.
3. **Run a Live Preview.** Set a scene — location, weather, time of day, which NPCs are present — and hit send. A full multi-NPC exchange renders, and the analysis panel breaks down every LLM call: what triggered it, who spoke, the exact rendered prompt, and how long it took.

---

## How your edits flow

The 3,000+ prompts SkyrimNet ships with are **read-only**. Anything you change is saved into your own *prompt set* layered on top — so you can experiment freely and always fall back to the originals.

```
Original prompts  ──►  Your prompt set  ──►  Exported .zip
(read-only,            (your edits,           (a valid mod,
 shipped tree)         saved as an overlay)   dropped into MO2)
```

> **You can't break the originals.** Every edit lands in a prompt set. Delete the set and you're back to stock — no reinstall needed.

---

## What each tool does

### Start here

- **Prompt Editor** — Browse and edit the full prompt tree with syntax highlighting, token counts, and live rendering of template variables. Originals stay read-only; your changes save to a set.
- **Live Preview** — Full multi-NPC dialogue simulations with a scene you configure. The analysis panel exposes triggers, speaker prediction, the rendered prompt, and response timing.
- **AI Chat (Tuner Agent)** — An assistant that can see your open prompt files. Ask it to critique a prompt's quality, explain a piece of template logic, or suggest concrete rewrites.

### Compare & measure

- **Multichat** — Feed the same dialogue to several models at once and read their replies side by side — with per-model latency and token counts as they stream.
- **Benchmark** — Pit model profiles against each other across every agent type on shared scenarios. Get per-turn latency, token usage, and AI-graded quality assessments.

### Automate

- **Auto Tuner** — Pick a profile and let it run iterative rounds — testing changes to settings, prompts, or both, scoring the results, and proposing improvements as it goes.
- **Copycat** — Choose a reference model whose voice you love, then tune a target model to match it — vocabulary, sentence rhythm, emotional range, and response length.

---

## Ship it to Skyrim

1. **Save Prompt Set.** Use the toolbar to name your edits. This bundles everything you've changed into one named set.
2. **Export Zip.** Download the set. It's already structured as a valid mod, with the correct `SKSE/Plugins/SkyrimNet/prompts/` layout inside.
3. **Drop it into Mod Organizer 2.** Extract into your MO2 mods folder, enable it, and let it win over the original SkyrimNet prompts. Your NPCs now speak with your tuning.

---

## The vocabulary

| Term | What it means |
|---|---|
| **Agent type** | One of SkyrimNet's distinct LLM calls — dialogue, action selection, game master, memory, diary, bio update, and more. Each can use its own model and settings. |
| **Profile** | A saved bundle of models plus inference settings. Switch between profiles and pit them against each other in Benchmark. |
| **Prompt set** | Your editable overlay of prompt files — the thing you export as a mod. The originals underneath never change. |
| **Inja template** | The `.prompt` file format — variables, loops, and blocks that render into the final text sent to the model. |

---

*Made for [SkyrimNet](https://www.nexusmods.com/skyrimspecialedition/mods/136172). No install required — unzip, run the `.exe`, and start tuning.*
