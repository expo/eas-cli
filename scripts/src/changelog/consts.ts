import { URL } from 'node:url';

export enum EntryCategory {
  BreakingChange = 'breaking-change',
  NewFeature = 'new-feature',
  BugFix = 'bug-fix',
  Chore = 'chore',
}

export const CHANGELOG_PATH = new URL('../../../CHANGELOG.md', import.meta.url);

export const CATEGORY_HEADERS: Record<EntryCategory, string> = {
  [EntryCategory.BreakingChange]: '🛠 Breaking changes',
  [EntryCategory.NewFeature]: '🎉 New features',
  [EntryCategory.BugFix]: '🐛 Bug fixes',
  [EntryCategory.Chore]: '🧹 Chores',
};
