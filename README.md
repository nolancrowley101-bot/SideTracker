# SideTracker

A Windows tray app that takes a screenshot every minute, checks it on-device for sensitive information, and nudges you when you've been sidetracked.

## How it works

1. Every `intervalSeconds` (default 60) it captures the screen the cursor is on. The image only exists in memory.
2. A local vision model (via [Ollama](https://ollama.com)) decides whether it shows sensitive info (passwords, keys, card numbers, IDs, private messages, ...). If so, the screenshot is dropped and never uploaded.
3. If the local check can't run or gives an unclear answer, the screenshot is also dropped (fails closed).
4. Safe screenshots are sent to the OpenAI API, which describes the activity and whether it matches the task you set.
5. If you've been off task for the threshold (default 10 min), you get a Windows notification.

Local model tiers (pick one in the app; each has a Download button):

| Tier | Default model |
|---|---|
| Large (23-27B) | `gemma3:27b` |
| Medium (9-12B) | `gemma4:12b` |
| Small (4-6B) | `gemma3:4b` |

Without a GPU, a 12B check can take several minutes per screenshot; use the small tier for faster cycles.

Your OpenAI API key is stored encrypted with Windows DPAPI (Electron `safeStorage`).

## Run from source

```
npm install
node node_modules/electron/install.js   # if the Electron binary wasn't downloaded
npm start
```

## Build the exe

```
npm run dist
```

Outputs an installer and a portable exe to `dist/` (built for the machine's architecture, e.g. arm64 on Windows on ARM).
