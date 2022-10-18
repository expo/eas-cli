import { CATEGORY_HEADERS } from './changelog/consts.js';
import { EntryCategory } from './changelog/entry.js';
import { readAndParseChangelogAsync } from './changelog/file.js';
import * as markdown from './markdown.js';

enum BumpStrategy {
  MAJOR = 'major',
  MINOR = 'minor',
  PATCH = 'patch',
}

type Counts = Record<EntryCategory, number>;

(async function main(): Promise<void> {
  const tokens = await readAndParseChangelogAsync();
  const counts = countEntriesPerCategory(tokens);
  // eslint-disable-next-line no-console
  console.log(getBumpStrategy(counts));
})().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

function countEntriesPerCategory(tokens: markdown.Tokens): Counts {
  const counts = Object.values(EntryCategory).reduce((acc, i) => {
    acc[i] = 0;
    return acc;
  }, {} as Counts);

  for (const [categoryHeader, categoryHeaderText] of Object.entries(CATEGORY_HEADERS)) {
    let i = 0;
    while (true) {
      const token = tokens[i];
      if (
        token.type === markdown.TokenType.HEADING &&
        token.depth === 3 &&
        token.text === categoryHeaderText
      ) {
        break;
      } else {
        i++;
      }
    }

    // if next token is a heading, there are no entries for this category
    if (tokens[i + 1].type === markdown.TokenType.HEADING) {
      continue;
    }

    // i points at the category heading
    // tokens[i + 1] is a list token
    const listToken = tokens[i + 1] as unknown as markdown.ListToken;
    counts[categoryHeader as EntryCategory] = listToken.items.length;
  }

  return counts;
}

function getBumpStrategy(counts: Counts): BumpStrategy {
  if (counts[EntryCategory.BreakingChange] > 0) {
    return BumpStrategy.MAJOR;
  }
  if (counts[EntryCategory.NewFeature] > 0) {
    return BumpStrategy.MINOR;
  }
  return BumpStrategy.PATCH;
}
