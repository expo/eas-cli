import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const PreparedExpoGoSchema = z.object({
  sdk: z.string().regex(/^\d+\.\d+\.\d+$/),
  url: z
    .string()
    .url()
    .refine(url => new URL(url).protocol === 'https:'),
});
export type PreparedExpoGo = z.infer<typeof PreparedExpoGoSchema>;

/** Optional archive metadata. Legacy CLI pins never select runtime package versions. */
export async function readPreparedExpoGoAsync(): Promise<PreparedExpoGo | undefined> {
  if (process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO === '0') {
    return undefined;
  }
  try {
    const contents = await fs.readFile(
      path.join(os.homedir(), 'Library', 'Caches', 'expo-simulator-startup', 'prepared.json'),
      'utf8'
    );
    const prepared = z
      .object({ tools: z.object({ 'expo-go': PreparedExpoGoSchema.optional() }) })
      .parse(JSON.parse(contents)).tools['expo-go'];
    const requested = process.env.EXPO_GO_SDK_VERSION;
    return requested && prepared?.sdk !== requested ? undefined : prepared;
  } catch {
    return undefined;
  }
}
