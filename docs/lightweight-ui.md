# Lightweight UI

## Problem

Desktop startup time is dominated by WebKit rendering a large static app. At
the measured baseline the main WebKit process was several hundred megabytes
and saw sustained high CPU while the editor was open. This affects the
marketing pages, examples pages and editor workspaces equally because they
all run inside one page.

## Research

- Disable OS decorations on desktop and replace the native title bar with a
  32 px custom bar that hosts close, minimize and maximize. This removes the
  OS controls, the double top row and lets the app own the top chrome.
  Confirmed with the Tauri 2 documentation: `decorations: false` plus a
  `data-tauri-drag-region` and `core:window:allow-start-dragging` is the
  supported way to build a custom title bar.
- Use `content-visibility: auto` on long offscreen lists. The web engine
  then skips style and layout work until the panel scrolls into view.
  List-heavy panels in the app include the project list, conversation
  history, message list and upload tray.
- Lazy-load routes with `React.lazy`. `DocsPage` and examples are already
  lazy; `AgentChatPanel` is not and is the largest module imported by the
  editor, so it should be lazy-loaded too.
- Avoid large blur layers on the desktop shell when decorations are disabled.
  The custom title bar should be a solid 8 px bar; keep the header blur only
  for the marketing header on large screens.
- Memoize canvases and large lists. `SimulatorCanvas`, `WireRenderer` and
  `DynamicComponent` already run per frame; add `React.memo` where they do
  not already and use `useMemo` for loops over `wires`, `components` and
  `channels`.
- Run stylelint and `tsc --noUnusedLocals` to remove dead selectors and
  unused imports before release.

## Implemented changes

1. The desktop window uses `decorations: false` with a 32 px custom title
   bar. It declares `data-tauri-drag-region` and requests the
   `core:window:allow-start-dragging` permission. The bar owns close,
   minimize, and maximize, and the hook order is stable on the web build.
2. Long lists use `content-visibility: auto`, including the project list,
   conversation history, message list, and upload tray.
3. The assistant panel is a flex sibling of the workspace and can be
   resized, minimized, or closed without covering the canvas. History is
   capped in memory. Long provider transcripts are compacted into a factual
   summary before each request, and tool result content is capped.
4. Simulation frames use bounded CPU budgets. The RP2040 scheduler stops a
   frame after 6 ms of CPU work, which leaves pointer, scroll, and paint work
   responsive on low-power machines. Serial buffers, conversation transcripts,
   and oscilloscope sample buffers are bounded.
5. The oscilloscope redraws at 20 fps while capturing instead of driving a
   60 Hz animation frame per sample. Canvases are DPR-aware and resize once
   per layout change rather than once per sample.
6. Example routes, the AI panel, the oscilloscope, and closed dialogs are
   lazy-loaded. Startup JavaScript fell from 4.62 MB to 2.09 MB, and the
   measured JS heap after load fell from 21.0 MB to 16.1 MB. PrismLight
   replaces the full Prism build.
7. Embedded WebKit falls back to software rendering when no GPU render device
   is found. `CIRCUIT_MUSE_SOFTWARE_RENDERING=1` forces that path.
8. Closing the window terminates the engine and emulator processes. The engine
   checks dependencies with `find_spec` instead of importing them at startup,
   which lowered idle engine memory from 89 MB to 52 MB.

## Remaining work

Profiling through `gdb` and `perf` is blocked by ptrace and perf permissions
on the development machine. Measurements rely on `top`, process inspection,
and screenshots. Further bundle splitting of editor-only modules remains
possible but has not been measured.

## Commands

```sh
npx stylelint "app/src/**/*.css"
npm --prefix app run typecheck
```
