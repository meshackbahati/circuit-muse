// Light Prism build with only the languages this app displays. The default
// `Prism` export bundles every Prism grammar (about 300 languages), which was
// loaded into memory with the docs and the AI panel. Unknown languages render
// as plain text.
import { PrismLight } from 'react-syntax-highlighter';
import arduino from 'react-syntax-highlighter/dist/esm/languages/prism/arduino';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import makefile from 'react-syntax-highlighter/dist/esm/languages/prism/makefile';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import nasm from 'react-syntax-highlighter/dist/esm/languages/prism/nasm';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';

const languages: Record<string, unknown> = {
  arduino,
  ino: arduino,
  bash,
  sh: bash,
  shell: bash,
  c,
  h: c,
  cpp,
  'c++': cpp,
  hpp: cpp,
  diff,
  ini,
  javascript,
  js: javascript,
  json,
  makefile,
  markdown,
  md: markdown,
  nasm,
  asm: nasm,
  python,
  py: python,
  micropython: python,
  typescript,
  ts: typescript,
  yaml,
  yml: yaml,
};

for (const [name, grammar] of Object.entries(languages)) {
  PrismLight.registerLanguage(name, grammar);
}

export { PrismLight as SyntaxHighlighter };
