import { URL } from 'node:url';

import { EntryCategory } from './entry.js';

export const CHANGELOG_PATH = new URL('../../../CHANGELOG.md', import.meta.url);

export const CATEGORY_HEADERS: Record<EntryCategory, string> = {
  [EntryCategory.BreakingChange]: '🛠 Breaking changes',
  [EntryCategory.NewFeature]: '🎉 New features',
  [EntryCategory.BugFix]: '🐛 Bug fixes',
  [EntryCategory.Chore]: '🧹 Chores',
};
