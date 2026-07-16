/**
 * Frontend wrapper for POST /api/compile-chip — compiles a Velxio custom-chip
 * C source to a base64-encoded WASM blob via the backend.
 */

export interface ChipCompileResult {
  success: boolean;
  wasm_base64: string | null;
  stdout: string;
  stderr: string;
  error: string | null;
  byte_size: number;
}

export interface ChipCompileStatus {
  available: boolean;
  wasi_sdk: string | null;
  sdk_include: string | null;
}

const BASE = '/api/compile-chip';

export async function compileChip(source: string, chipJson?: string): Promise<ChipCompileResult> {
  const res = await fetch(`${BASE}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ source, chip_json: chipJson ?? null }),
  });
  if (!res.ok) {
    const text = await res.text();
    return {
      success: false,
      wasm_base64: null,
      stdout: '',
      stderr: '',
      error: `HTTP ${res.status}: ${text}`,
      byte_size: 0,
    };
  }
  return (await res.json()) as ChipCompileResult;
}

export async function chipCompileStatus(): Promise<ChipCompileStatus> {
  const res = await fetch(`${BASE}/status`, { credentials: 'include' });
  return (await res.json()) as ChipCompileStatus;
}
