import { truthy } from '../../../utils/expodash/filter';
import { IssueRule } from '../../config/issue';
import { AppleInfo } from '../types';

const RESTRICTED_PROPERTIES: (keyof AppleInfo)[] = ['title', 'subtitle', 'description', 'keywords'];
const RESTRICTED_WORDS = {
  beta: 'Apple restricts the word "beta" and synonyms implying incomplete functionality.',
};

/**
 * Apple restricts certain words from being used in name, description, or keywords.
 * Using these words likely result in a rejection.
 */
export const infoRestrictedWords: IssueRule = {
  id: 'apple.info.restrictedWords',
  severity: 1,
  validate(config) {
    if (!config.apple?.info || Object.keys(config.apple.info).length === 0) {
      return null;
    }

    return Object.keys(config.apple.info)
      .map(locale =>
        RESTRICTED_PROPERTIES.map(property => {
          const value = getStringValue(config.apple?.info?.[locale][property]);
          const issueDescription = getDescriptionForFirstMatch(value);

          if (issueDescription) {
            return {
              id: this.id,
              severity: this.severity,
              path: ['apple', 'info', locale, property],
              message: issueDescription,
            };
          }

          return null;
        }).filter(truthy)
      )
      .filter(truthy)
      .flat();
  },
};

function getDescriptionForFirstMatch(value: string): string | null {
  const sanitized = value.toLowerCase();

  for (const [word, description] of Object.entries(RESTRICTED_WORDS)) {
    if (sanitized.includes(word)) {
      return description;
    }
  }

  return null;
}

function getStringValue(value?: null | string | string[]): string {
  if (!value) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.join(' ');
  }

  return value;
}
