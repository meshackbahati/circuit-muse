/**
 * Images attached in the chat go to the model as image input. Before this,
 * they were only reachable through read_uploaded_file as base64 text, which a
 * model cannot see and which was cut off at the tool-result size limit.
 */
import type { Message, MessageImage } from './types';
import type { UploadedFile } from '../store/useUploadsStore';

/** Long side limit; within every provider's image limits and token-friendly. */
const MAX_SIDE = 1568;
/** Only the most recent image-bearing messages keep their pixels in a request. */
export const MAX_IMAGE_MESSAGES = 3;

function splitDataUrl(dataUrl: string): MessageImage | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

/** Downscale to MAX_SIDE (JPEG, or PNG to keep transparency) in the browser. */
async function shrink(dataUrl: string, width?: number, height?: number): Promise<string> {
  const w = width ?? 0;
  const h = height ?? 0;
  if ((w && h && Math.max(w, h) <= MAX_SIDE) || typeof document === 'undefined') return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale >= 1) return resolve(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = dataUrl.startsWith('data:image/png');
      resolve(canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Images from the upload tray that have not been sent to the model yet. */
export async function imagesForNextMessage(files: UploadedFile[]): Promise<{ images: MessageImage[]; ids: string[] }> {
  const images: MessageImage[] = [];
  const ids: string[] = [];
  for (const f of files) {
    if (f.kind !== 'image' || !f.dataUrl || f.sentAt) continue;
    let dataUrl = await shrink(f.dataUrl, f.width, f.height);
    let image = splitDataUrl(dataUrl);
    if (image && !SUPPORTED.has(image.mediaType) && typeof document !== 'undefined') {
      // BMP, SVG, etc.: providers accept PNG/JPEG/WebP/GIF only.
      dataUrl = await shrink(f.dataUrl, MAX_SIDE + 1, MAX_SIDE + 1);
      image = splitDataUrl(dataUrl);
    }
    if (!image || !SUPPORTED.has(image.mediaType)) continue;
    images.push({ ...image, name: f.name });
    ids.push(f.id);
  }
  return { images, ids };
}

/** Keep pixels only on the last few image-bearing messages of a request. */
export function limitImages(messages: Message[]): Message[] {
  let kept = 0;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (!m.images?.length) continue;
    if (kept < MAX_IMAGE_MESSAGES) {
      kept++;
      continue;
    }
    const names = m.images.map((img) => img.name ?? 'image').join(', ');
    out[i] = { ...m, images: undefined, content: `${m.content}\n[earlier image omitted: ${names}]` };
  }
  return out;
}
