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

## Planned changes

1. Disable `decorations` on the desktop window and add a 32 px custom title
   bar with dragging and window controls.
2. Add `content-visibility: auto` to the project list, history list, message
   list and upload tray.
3. Split `AgentChatPanel` into a lazy chunk, remove `BlazeMarkdown` and any
   other editor-only modules from the initial editor bundle if feasible.
4. Measure after each change with `top` and `spectacle`, then tune by at
   least 10 percent or revert.

## Commands

```sh
npx stylelint "app/src/**/*.css"
npm --prefix app run typecheck
```
