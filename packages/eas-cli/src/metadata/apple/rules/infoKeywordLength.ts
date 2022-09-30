import { IssueRule } from '../../config/issue';
import { coalesce } from '../../utils/array';

const KEYWORD_CHARACTER_LIMIT = 100;

/**
 * Keywords are limited to 100 characters when converted to a comma separated string string.
 * @see https://developer.apple.com/app-store/search/
 */
export const infoKeywordLength: IssueRule = {
  id: 'apple.info.keyword.length',
  severity: 2,
  validate(config) {
    if (!config.apple?.info || !Object.keys(config.apple.info).length) {
      return null;
    }

    return coalesce(
      Object.keys(config.apple.info).map(locale => {
        const keywords = config.apple?.info?.[locale].keywords ?? [];
        const length = keywords.join(',').length;

        if (length > KEYWORD_CHARACTER_LIMIT) {
          return {
            id: this.id,
            severity: this.severity,
            path: ['apple', 'info', locale, 'keywords'],
            message: `Keywords are limited to ${KEYWORD_CHARACTER_LIMIT} characters, but found ${length}.`,
          };
        }

        return null;
      })
    );
  },
};
