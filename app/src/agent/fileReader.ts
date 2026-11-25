import JSZip from 'jszip';
import type { UploadedFile } from '../store/useUploadsStore';

const TEXT_EXTENSIONS = ['txt', 'md', 'json', 'csv', 'xml', 'yml', 'yaml', 'ino', 'c', 'cpp', 'h', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'log', 'svg'];

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function docxText(xml: string): string {
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(line => decodeEntities(line).trim())
    .filter(Boolean)
    .join('\n');
}

function decodePdfString(raw: string): string {
  if (raw.startsWith('<')) {
    const hex = raw.slice(1, -1).replace(/\s/g, '');
    let out = '';
    for (let i = 0; i + 1 < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
  }
  return raw.slice(1, -1).replace(/\\([nrtbf()\\])/g, (_, c) => {
    const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
    return map[c] ?? c;
  });
}

function pdfStrings(content: string): string[] {
  const found: string[] = [];
  for (const block of content.match(/BT[\s\S]*?ET/g) ?? []) {
    const ops = block.match(/\((?:\\.|[^\\)])*\)\s*Tj|\[(?:\\.|[^\]])*\]\s*TJ/g) ?? [];
    for (const op of ops) {
      const pieces = op.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g) ?? [];
      const text = pieces.map(decodePdfString).join('');
      if (text.trim()) found.push(text);
    }
  }
  return found;
}

async function inflatePdfStream(bytes: Uint8Array): Promise<string> {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new TextDecoder('latin1').decode(await new Response(stream).arrayBuffer());
}

async function pdfText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const latin = new TextDecoder('latin1').decode(bytes);
  const chunks: string[] = [];
  const pattern = /([\s\S]{0,400}?)stream\r?\n([\s\S]*?)\r?\nendstream/g;

  for (const match of latin.matchAll(pattern)) {
    const header = match[1];
    const body = match[2];
    let content = body;
    if (header.includes('/FlateDecode')) {
      const raw = new Uint8Array(body.length);
      for (let i = 0; i < body.length; i++) raw[i] = body.charCodeAt(i) & 0xff;
      try {
        content = await inflatePdfStream(raw);
      } catch {
        content = body;
      }
    }
    chunks.push(...pdfStrings(content));
  }

  const text = chunks.join('\n').trim();
  return text || `PDF file, ${bytes.length} bytes. No extractable text layer was found.`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });
}

export async function readUploadedFile(file: File): Promise<UploadedFile> {
  const id = crypto.randomUUID();
  const ext = extension(file.name);
  const mime = file.type || '';
  const base = { id, name: file.name, mime, size: file.size };

  try {
    if (mime.startsWith('image/')) {
      const dataUrl = await blobToDataUrl(file);
      const size = await imageSize(dataUrl);
      return { ...base, kind: 'image', dataUrl, ...size };
    }

    if (ext === 'docx') {
      const zip = await JSZip.loadAsync(file);
      const xml = await zip.file('word/document.xml')?.async('string');
      if (!xml) throw new Error('document.xml missing from DOCX');
      return { ...base, kind: 'docx', text: docxText(xml) };
    }

    if (ext === 'pdf' || mime === 'application/pdf') {
      return { ...base, kind: 'pdf', text: await pdfText(await file.arrayBuffer()) };
    }

    if (TEXT_EXTENSIONS.includes(ext) || mime.startsWith('text/')) {
      return { ...base, kind: 'text', text: await file.text() };
    }

    return { ...base, kind: 'binary', text: `Unsupported file type: ${file.name}` };
  } catch (error) {
    return {
      ...base,
      kind: 'binary',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
