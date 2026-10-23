import * as fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';

const Action = z.strictObject({
  action: z.string().min(1),
  params: z.record(z.string(), z.json()).default({}),
  file: z.string().min(1).optional(),
  output: z.string().min(1).optional(),
});

const Config = z.strictObject({
  version: z.literal(1),
  start: z.record(z.string(), z.json()).optional(),
  actions: z.array(Action).min(1).optional(),
});

export type SimulatorSessionConfig = z.infer<typeof Config> & { path: string };

export async function readSimulatorSessionConfigAsync(
  filePath: string
): Promise<SimulatorSessionConfig> {
  const absolutePath = path.resolve(filePath);
  let input: unknown;
  try {
    input = await fs.readJson(absolutePath);
  } catch (error) {
    throw new Error(
      `Could not read simulator configuration ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  const parsed = Config.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid simulator configuration ${absolutePath}: ${detail}`);
  }
  return { ...parsed.data, path: absolutePath };
}
