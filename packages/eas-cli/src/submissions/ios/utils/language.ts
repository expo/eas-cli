import log from '../../../log';

export const LANGUAGES = [
  'Brazilian Portuguese',
  'Danish',
  'Dutch',
  'English',
  'English_Australian',
  'English_CA',
  'English_UK',
  'Finnish',
  'French',
  'French_CA',
  'German',
  'Greek',
  'Indonesian',
  'Italian',
  'Japanese',
  'Korean',
  'Malay',
  'Norwegian',
  'Portuguese',
  'Russian',
  'Simplified Chinese',
  'Spanish',
  'Spanish_MX',
  'Swedish',
  'Thai',
  'Traditional Chinese',
  'Turkish',
  'Vietnamese',
];

/**
 * Sanitizes language for `travelingFastlane app_produce` command.
 * @param lang Language to sanitize
 * @returns Provided language if valid
 * @throws Error if language is invalid.s
 */
export function sanitizeLanguage(lang?: string): string | undefined {
  if (lang && !LANGUAGES.includes(lang)) {
    const langList = LANGUAGES.map(lang => `- ${lang}`).join('\n');

    log.addNewLineIfNone();
    throw new Error(`You must specify a supported language. Supported languages are:\n${langList}`);
  }

  return lang;
}
