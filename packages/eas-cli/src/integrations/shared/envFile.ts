import chalk from 'chalk';
import dotenv from 'dotenv';
import * as fs from 'fs-extra';
import path from 'path';

import { EnvVar } from '../../environments/variables';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import { formatEnvValue } from '../../utils/dotenv';

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

// Copied from dotenv (lib/main.js) so this finds exactly the keys dotenv.parse reports above.
const DOTENV_LINE =
  /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/gm;

export function mergeEnvContent(rawContent: string, newVars: Record<string, string>): string {
  const edits: { start: number; end: number; text: string }[] = [];
  const rewritten = new Set<string>();
  const regex = new RegExp(DOTENV_LINE.source, `${DOTENV_LINE.flags}d`);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawContent)) !== null) {
    const key = match[1];
    if (!Object.hasOwn(newVars, key) || !match.indices) {
      continue;
    }
    // match[0] runs past the value onto a following comment line, so spans come from the groups.
    const [keyStart, keyEnd] = match.indices[1];
    const valueRange = match.indices[2];
    const definitionEnd = valueRange
      ? valueRange[1] - (/\s+$/.exec(match[2])?.[0].length ?? 0)
      : keyEnd + (/^[ \t]*(?:=[ \t]*|:[ \t]+)/.exec(rawContent.slice(keyEnd))?.[0].length ?? 0);

    if (!rewritten.has(key)) {
      rewritten.add(key);
      edits.push({
        start: keyStart,
        end: definitionEnd,
        text: `${key}=${formatEnvValue(newVars[key])}`,
      });
      continue;
    }
    // dotenv lets a later definition win, so an extra one left behind would keep the stale value.
    const nextNewline = rawContent.indexOf('\n', definitionEnd);
    edits.push({
      start: rawContent.lastIndexOf('\n', keyStart - 1) + 1,
      end: nextNewline === -1 ? rawContent.length : nextNewline + 1,
      text: '',
    });
  }

  let content = rawContent;
  for (const { start, end, text } of edits.reverse()) {
    content = content.slice(0, start) + text + content.slice(end);
  }

  for (const [key, value] of Object.entries(newVars).filter(([key]) => !rewritten.has(key))) {
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += `${key}=${formatEnvValue(value)}\n`;
  }
  return content;
}
