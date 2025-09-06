import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export function getTemporaryPath(): string {
  return path.join(os.tmpdir(), Math.random().toString(36).substring(2));
}

export async function safelyDeletePathAsync(value: string): Promise<void> {
  try {
    await fs.rm(value, { recursive: true, force: true });
  } catch {}
}
