
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Made with 🧠 by Basil](https://img.shields.io/badge/Made%20by-Basil%20Jackson-brightgreen)](https://github.com/Baswold)


# The Basil Loop

The Basil Loop is not a generic chat UI. It is a purpose-built refinement loop that orchestrates a panel of small Ollama models so their combined output **beats what any single tiny model can do on its own**. The interface gives the loop space to breathe—an open, midnight-dark transcript canvas with just the composer pinned to the bottom—while the orchestration layer plans, drafts, compares, and polishes every response before it reaches the user.

## 🎥 Demo Video

[![Watch the demo on Vimeo](https://img.shields.io/badge/Demo-Play%20on%20Vimeo-blue?logo=vimeo)](https://vimeo.com/1102758969)


## Project Structure

```
ollama-chat-ui/
├── index.html      # Main HTML interface
├── styles.css      # CSS styling
├── app.js          # Frontend JavaScript
├── server.js       # Express proxy server (optional)
├── package.json    # Node.js dependencies
└── README.md       # This file
```

## Setup

1. **Make sure Ollama is running:**
   ```bash
   ollama serve
   ```

2. **Install the small models you want to boost:**
   ```bash
   ollama pull gemma:2b
   ollama pull codegemma:2b
   ```

3. **Install frontend dependencies (once):**
   ```bash
   npm install
   ```

## Usage

### Run with the Express proxy (recommended)

This serves the static files and forwards requests to Ollama with CORS headers already handled:

```bash
npm start
```

Then open `http://localhost:3000` in your browser.

### Direct file opening (quick peek)

Open `index.html` directly in a browser if you just want to preview the UI. Any attempt to talk to Ollama without the proxy may be blocked by CORS, so the proxy route is preferred for real use.

## What the loop actually does

1. **Model Selection First** – a text-first agent weighs heuristics and user overrides before anything else, locking in either `gemma:2b` or `codegemma:2b` for the drafting passes. The decision surfaces right at the top of the transcript so you always know which specialist is in charge before any other agent speaks.
2. **Prompt Refinement** – rewrites the ask so the follow-up agents receive crisp, detailed instructions.
3. **Planning on Text** – gemma:2b always handles the planning brief, even for coding work, so structure and reasoning stay strong.
4. **Optional Search** – fetches fresh references when the topic looks like it needs external facts.
5. **Twin Drafts & Comparison** – two drafts race, a comparison agent picks the stronger candidate.
6. **Direction Injection** – a quality critic spells out concrete fixes, and those directions are fed straight back into the next drafting prompt so the tiny writer model measurably improves each pass.
7. **Checker** – decides if the answer meets the bar. If not, the guidance loops back for another drafting pass.

By forcing tiny local models to clarify, plan, compete, absorb explicit revision notes, and self-review, the Basil Loop consistently ships answers that feel like they came from something much larger. The gemma/codegemma 2B pair in particular benefits because every pass is steered by concrete critiques instead of leaving the small model to wander.

## Smart model routing

The loop now recognises multiple signals before it locks in a model:

- User intent such as “use the coding model” or “stay on the text model”.
- Keyword heuristics pulled from the original request plus code fences and file extensions that usually indicate programming work.
- The model agent’s streamed recommendation, with fallbacks that keep coding work on `codegemma:2b` when the signals disagree.

If you really want one model, just say so in your prompt—the router now honours that override immediately and still double-checks the heuristics. Planning, comparison, direction, and checking always run on the text model so reasoning quality never regresses even when the drafting passes switch to `codegemma:2b` for code-heavy work.

## Interface highlights

- Flat midnight aesthetic: no 3D chrome or gradients—just charcoal surfaces, crisp borders, and accent colour pops when the loop reports back.
- Open canvas: the transcript fills the viewport and the only anchored UI is the bottom composer, so every agent note feels airy.
- Auto-expanding prompt: the input starts compact so the surface feels open, then grows fluidly with your thoughts instead of hiding them behind scroll bars.
- Slim timeline: reasoning steps are narrower, left-aligned, and labelled (e.g. “Step 1 · Model selection”) so the open canvas stays in view even when the loop goes deep.
- Streaming UX: messages render chunk-by-chunk, the Stop button aborts instantly, and copy buttons sit on every agent step.

## Troubleshooting

- **“Error processing request”** – Start Ollama with `ollama serve`.
- **Loop keeps using the wrong model** – Add “use the coding model” / “use the text model” to the prompt. The router now honours that override and also reads coding cues from your prompt.
- **CORS warnings** – Use `npm start` so the proxy can forward requests.
- **Models missing** – Pull them with `ollama pull gemma:2b` or `ollama pull codegemma:2b`.
