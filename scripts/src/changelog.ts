import dateFormat from 'dateformat';
import fs from 'fs-extra';
import path from 'path';
import semver from 'semver';

import * as markdown from './markdown';

type Tokens = markdown.Token[];

const CHANGELOG_PATH = path.join(__dirname, '../../CHANGELOG.md');

const MAIN_CATEGORIES = ['🛠 Breaking changes', '🎉 New features', '🐛 Bug fixes', '🧹 Chores'].map(
  text => markdown.createHeadingToken(text, 3)
);
const FORMAT_RELEASE_HEADING = (version: string): markdown.Token =>
  markdown.createHeadingToken(
    `[${version}](https://github.com/expo/eas-cli/releases/tag/${version}) - ${dateFormat(
      'isoDate'
    )}`,
    2
  );

(async function main(version: string): Promise<void> {
  if (!semver.valid(version)) {
    throw new Error(`Usage: yarn release-changelog SEMVER`);
  }

  const tokens = await readAndParseChangelogAsync();
  removeEmptyCategories(tokens);
  insertNewEmptyCategoriesAndReleaseHeading(tokens, version);
  const newChangelog = markdown.render(tokens);
  await fs.writeFile(CHANGELOG_PATH, newChangelog);
  findAndPrintCurrentReleaseChangelog(tokens, version);
})(process.argv[process.argv.length - 1]).catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

async function readAndParseChangelogAsync(): Promise<Tokens> {
  const contents = await fs.readFile(CHANGELOG_PATH, 'utf8');
  return markdown.lexify(contents);
}

function removeEmptyCategories(tokens: Tokens): void {
  const idxToRemove: number[] = [];

  let i = 0;
  for (let j = 0; j < MAIN_CATEGORIES.length; j++) {
    // find index of the category
    while (true) {
      const token = tokens[i];
      if (token.type === markdown.TokenType.HEADING && token.depth === 3) {
        break;
      } else {
        i++;
      }
    }

    // i points at the category heading
    if (tokens[i + 1].type === markdown.TokenType.HEADING) {
      // the category is empty
      idxToRemove.push(i);
    }

    i++;
  }

  // start iterating from the end of list so we don't have to update indices
  for (let j = idxToRemove.length - 1; j >= 0; j--) {
    tokens.splice(idxToRemove[j], 1);
  }
}

function insertNewEmptyCategoriesAndReleaseHeading(tokens: Tokens, version: string): void {
  let i = 0;
  while (true) {
    const token = tokens[i++];
    if (token.type === markdown.TokenType.HEADING && token.text.trim() === 'main') {
      break;
    }
  }

  // i points at the index after the main heading
  const releaseHeading = FORMAT_RELEASE_HEADING(version);
  tokens.splice(i, 0, ...MAIN_CATEGORIES, releaseHeading);
}

function findAndPrintCurrentReleaseChangelog(tokens: Tokens, version: string): void {
  const startIdx = tokens.findIndex(
    token =>
      token.type === markdown.TokenType.HEADING && token.depth === 2 && token.text.trim() !== 'main'
  );
  const endIdx = tokens.findIndex(
    (token, idx) => idx > startIdx && token.type === markdown.TokenType.HEADING && token.depth === 2
  );
  const currentReleaseTokens = tokens.slice(startIdx + 1, endIdx);
  const rendered = markdown.render(currentReleaseTokens);
  // eslint-disable-next-line no-console
  console.log(`v${version}\n\n${rendered.trim()}`);
}
