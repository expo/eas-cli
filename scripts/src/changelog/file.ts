import fs from 'fs-extra';

import * as markdown from '../markdown.js';
import { CHANGELOG_PATH } from './consts.js';

export async function readAndParseChangelogAsync(): Promise<markdown.Tokens> {
  const contents = await fs.readFile(CHANGELOG_PATH, 'utf8');
  return markdown.lexify(contents);
}

export async function writeChangelogAsync(tokens: markdown.Tokens): Promise<void> {
  const newChangelog = markdown.render(tokens);
  await fs.writeFile(CHANGELOG_PATH, newChangelog);
}
