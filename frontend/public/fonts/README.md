# Self-hosted webfonts

Velxio's design system depends on two variable fonts shipped from this directory:

- `Inter.var.woff2` — Inter variable, 100-900 weight axis. Source: https://github.com/rsms/inter/releases (download the latest, copy `Inter.var.woff2`).
- `JetBrainsMono.var.woff2` — JetBrains Mono variable, 100-800 weight axis. Source: https://github.com/JetBrains/JetBrainsMono/releases (latest tag, file is `webfonts/JetBrainsMono[wght].woff2` — rename to `JetBrainsMono.var.woff2`).

Both are SIL Open Font License 1.1 — include the LICENSE files alongside the woff2 if redistributing.

## Why self-hosted

We previously used `-apple-system, SF Pro` which renders correctly on macOS only. Inter renders identically across Mac, Windows, Linux, Android. JetBrains Mono ships every glyph the editor needs (box-drawing, ligatures off by default — Monaco handles its own font separately, but our `<pre>` and inline `<code>` use this).

## Preload

Both fonts are preloaded in `index.html`:

```html
<link rel="preload" as="font" type="font/woff2" href="/fonts/Inter.var.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/fonts/JetBrainsMono.var.woff2" crossorigin>
```

The `crossorigin` attribute is required — without it the browser fetches twice.

## Verifying

After deploy, in DevTools Network tab filter by "Font". Should show two requests, both with `(memory cache)` after the first page load. If you see Roboto / Segoe UI / Helvetica fall through, the font failed to load — check the woff2 path and CORS headers from your CDN.
