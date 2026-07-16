#!/usr/bin/env node
/**
 * Auto-translate the React app's i18n bundles. Reads
 * `src/i18n/locales/en/<namespace>.json` and writes the equivalent
 * `src/i18n/locales/<locale>/<namespace>.json` for every non-default
 * locale, calling DeepSeek (primary) with a Gemini fallback.
 *
 * One LLM call per (locale, namespace) pair. The whole bundle is sent
 * in a single request — works as long as a single namespace stays
 * roughly under a few thousand tokens. If a namespace grows past that,
 * split it before the request balloons.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=sk-... node scripts/translate-i18n.mjs
 *   DEEPSEEK_API_KEY=sk-... node scripts/translate-i18n.mjs --locale es
 *   DEEPSEEK_API_KEY=sk-... node scripts/translate-i18n.mjs --force
 *
 * Flags:
 *   --locale <code>   Process only one target locale. Otherwise all 8.
 *   --namespace <ns>  Process only one namespace. Otherwise auto-detect.
 *   --force           Overwrite existing target files. Default skips them.
 */

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const LOCALES_DIR = resolve(ROOT, "src/i18n/locales");
const SOURCE_LOCALE = "en";
const TARGET_LOCALES = [
  "es",
  "pt-br",
  "it",
  "fr",
  "zh-cn",
  "de",
  "ja",
  "ru",
];
const LOCALE_NAMES = {
  en: "English",
  es: "Spanish (Spain)",
  "pt-br": "Brazilian Portuguese",
  it: "Italian",
  fr: "French",
  "zh-cn": "Simplified Chinese",
  de: "German",
  ja: "Japanese",
  ru: "Russian",
};

// ── Provider helpers ────────────────────────────────────────────────────
async function callDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");
  const res = await fetch(
    (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com") +
      "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        max_tokens: 8192,
        response_format: { type: "json_object" },
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`DeepSeek HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("DeepSeek returned empty content");
  }
  return content;
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
    contents: prompt,
  });
  const content = res?.text;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Gemini returned empty content");
  }
  return content;
}

// ── Prompt + parsing ────────────────────────────────────────────────────
function buildPrompt(targetLocale, sourceJson) {
  const targetName = LOCALE_NAMES[targetLocale] ?? targetLocale;
  return `You are a professional UI translator working on a software product.

Translate the JSON file below from English to ${targetName}.

CRITICAL RULES — follow ALL of them:
1. Preserve the JSON structure exactly: same keys, same nesting, same array order.
2. Translate ONLY the string VALUES, never the keys.
3. Brand names and proper nouns stay UNCHANGED in the original case:
   "Velxio", "Arduino", "ESP32", "ESP32-S3", "ESP32-C3", "RP2040", "ATtiny85",
   "Raspberry Pi", "Raspberry Pi Pico", "GitHub", "Discord", "AGPLv3", "MIT",
   "SPICE", "Monaco", "wokwi", "wokwi-elements", "avr8js".
4. Acronyms / standards stay in their original form: "USART", "GPIO", "I2C",
   "SPI", "BLE", "WiFi", "PWM", "DAC", "ADC".
5. Do not translate technical product nouns that act as proper names in
   context (e.g. "Documentation" → translate; but "Editor" used as a
   product page name may stay literal in some languages — use the natural
   localised noun for "code editor").
6. Keep lengths reasonable: UI labels are short, don't pad them.
7. Output ONLY the translated JSON. No markdown fence, no commentary,
   no leading/trailing whitespace beyond the JSON body itself.

Source JSON (English):
${JSON.stringify(sourceJson, null, 2)}`;
}

function extractJson(raw) {
  let t = raw.trim();
  // Strip code fence if present.
  const fence = /^```(?:json)?\r?\n([\s\S]*?)\r?\n```$/;
  const m = fence.exec(t);
  if (m) t = m[1].trim();
  return JSON.parse(t);
}

function sameShape(a, b) {
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length;
  if (typeof a === "object") {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) return false;
      if (!sameShape(a[aKeys[i]], b[bKeys[i]])) return false;
    }
    return true;
  }
  return true; // primitives — values differ but type matches
}

// ── Main ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { locale: null, namespace: null, force: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--locale") out.locale = argv[++i];
    else if (a === "--namespace") out.namespace = argv[++i];
    else if (a === "--force") out.force = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

async function listNamespaces() {
  const sourceDir = resolve(LOCALES_DIR, SOURCE_LOCALE);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith(".json"))
    .map(e => e.name.replace(/\.json$/, ""));
}

async function translateOne(targetLocale, namespace, sourceJson, opts) {
  const targetPath = resolve(
    LOCALES_DIR,
    targetLocale,
    `${namespace}.json`
  );
  if (!opts.force) {
    try {
      await readFile(targetPath, "utf8");
      console.log(`  - ${targetLocale}/${namespace}.json (exists, skip)`);
      return;
    } catch {
      /* not there yet, proceed */
    }
  }

  const prompt = buildPrompt(targetLocale, sourceJson);

  let translated;
  let provider;
  try {
    const raw = await callDeepSeek(prompt);
    translated = extractJson(raw);
    provider = "deepseek";
  } catch (err) {
    console.warn(`  ! deepseek failed for ${targetLocale}: ${err.message}`);
    if (!process.env.GEMINI_API_KEY) throw err;
    const raw = await callGemini(prompt);
    translated = extractJson(raw);
    provider = "gemini";
  }

  if (!sameShape(sourceJson, translated)) {
    throw new Error(
      `${targetLocale}/${namespace}: shape mismatch — model added/removed keys`
    );
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    JSON.stringify(translated, null, 2) + "\n",
    "utf8"
  );
  console.log(`  v ${targetLocale}/${namespace}.json (via ${provider})`);
}

async function main() {
  const opts = parseArgs(process.argv);
  const targetLocales = opts.locale ? [opts.locale] : TARGET_LOCALES;
  const namespaces = opts.namespace ? [opts.namespace] : await listNamespaces();

  if (!process.env.DEEPSEEK_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error(
      "Set DEEPSEEK_API_KEY (and optionally GEMINI_API_KEY) before running."
    );
    process.exit(1);
  }

  for (const ns of namespaces) {
    const sourcePath = resolve(LOCALES_DIR, SOURCE_LOCALE, `${ns}.json`);
    const sourceJson = JSON.parse(await readFile(sourcePath, "utf8"));
    console.log(`namespace: ${ns}`);
    for (const target of targetLocales) {
      try {
        await translateOne(target, ns, sourceJson, opts);
      } catch (err) {
        console.error(`  x ${target}/${ns}: ${err.message}`);
      }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
