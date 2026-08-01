import chalk from 'chalk';
import dotenv from 'dotenv';
import * as fs from 'fs-extra';
import path from 'path';

import { EnvVar } from '../../environments/variables';
import Log from '../../log';
import { confirmAsync } from '../../prompts';

export async function writeEnvLocalAsync(
  projectDir: string,
  envVars: EnvVar[],
  {
    label,
    nonInteractive,
    overwrite,
  }: { label: string; nonInteractive: boolean; overwrite: boolean }
): Promise<boolean> {
  const envPath = path.join(projectDir, '.env.local');
  let rawContent = '';
  if (await fs.pathExists(envPath)) {
    rawContent = await fs.readFile(envPath, 'utf8');
    const existing = dotenv.parse(rawContent);
    const conflicts = envVars.filter(v => existing[v.name] !== undefined);
    if (conflicts.length > 0 && !overwrite) {
      if (nonInteractive) {
        Log.warn(
          `.env.local already defines ${conflicts.map(v => v.name).join(', ')}; skipped (pass --overwrite to replace).`
        );
        return false;
      }
      const confirmed = await confirmAsync({
        message: `.env.local already defines ${conflicts
          .map(v => v.name)
          .join(', ')}. Overwrite with the ${label} values?`,
      });
      if (!confirmed) {
        Log.warn(`Skipped updating ${chalk.bold('.env.local')}.`);
        return false;
      }
    }
  }

  const updatedContent = mergeEnvContent(
    rawContent,
    Object.fromEntries(envVars.map(v => [v.name, v.value]))
  );
  await fs.writeFile(envPath, updatedContent);
  Log.withTick(`Wrote ${label} config to ${chalk.bold('.env.local')}`);
  return true;
}

export function mergeEnvContent(rawContent: string, newVars: Record<string, string>): string {
  let content = rawContent;
  const keysToAdd: Record<string, string> = { ...newVars };
  for (const [key, value] of Object.entries(newVars)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, () => `${key}=${value}`);
      delete keysToAdd[key];
    }
  }
  const remaining = Object.entries(keysToAdd);
  if (remaining.length > 0) {
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    for (const [key, value] of remaining) {
      content += `${key}=${value}\n`;
    }
  }
  return content;
}
