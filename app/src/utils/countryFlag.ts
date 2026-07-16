/**
 * Convert ISO-3166 alpha-2 country code to a flag emoji.
 *
 * Works by mapping each letter to its Unicode regional indicator symbol
 * (offset 0x1F1E6 from 'A'). Returns the original code (or fallback) if
 * input is invalid.
 */
export function countryFlag(code: string | null | undefined): string {
  if (!code) return '🌐';
  const trimmed = code.trim().toUpperCase();
  if (trimmed.length !== 2 || !/^[A-Z]{2}$/.test(trimmed)) return '🌐';
  const A = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return String.fromCodePoint(A + (trimmed.charCodeAt(0) - a)) +
    String.fromCodePoint(A + (trimmed.charCodeAt(1) - a));
}

export function countryLabel(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  return code.toUpperCase();
}
