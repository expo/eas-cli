export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Collapse whitespace + lowercase — for tolerant code matching / fingerprinting. */
export function normalizeCode(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}
