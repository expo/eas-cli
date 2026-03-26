import { Platform } from '@expo/eas-build-job';

const PLURAL_WORDS: Record<string, string> = {
  entry: 'entries',
};

export const pluralize = (count: number, word: string): string => {
  const shouldUsePluralWord = count > 1 || count === 0;
  const pluralWord = PLURAL_WORDS[word] ?? `${word}s`;

  return shouldUsePluralWord ? pluralWord : word;
};

export const PlatformToProperNounMap: Record<Platform, string> = {
  [Platform.ANDROID]: 'Android',
  [Platform.IOS]: 'iOS',
};
