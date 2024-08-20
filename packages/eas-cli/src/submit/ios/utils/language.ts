import Log from '../../../log';

type Language = {
  locale: string;
  name: string;
  itcLocale?: string;
  displayName?: string;
};

/**
 * Sanitizes language for App Store Connect.
 * @param lang Language to sanitize
 * @returns Provided language if valid
 * @throws Error if language is invalid.s
 */
export function sanitizeLanguage(
  lang?: string,
  { defaultLang = 'en-US' }: { defaultLang?: string } = {}
): string {
  if (!lang) {
    const found = findLanguage(defaultLang);
    if (!found) {
      throw new Error('Invalid default language provided: ' + defaultLang);
    }
    return found.itcLocale ?? found.locale;
  }

  const foundLang = findLanguage(lang);
  if (!foundLang) {
    Log.addNewLineIfNone();
    throw new Error(
      `You must specify a supported language. Supported language codes are:\n${languageListToString()}`
    );
  }

  return foundLang.itcLocale ?? foundLang.locale;
}

/**
 * Displays language list. When using apple utils, the format is:
 * - en-US  (English)
 *
 * otherwise it's just:
 * - English
 */
function languageListToString(): string {
  return LANGUAGES.map(lang => {
    const code = lang.itcLocale ?? lang.locale;
    const name = lang.displayName ?? lang.name;
    return `- ${code}\t(${name})`;
  }).join('\n');
}

/**
 * Finds language by any param.
 */
function findLanguage(query: string): Language | null {
  const foundLang = LANGUAGES.find(
    lang =>
      lang.displayName === query ||
      lang.name === query ||
      lang.locale === query ||
      lang.itcLocale === query
  );

  return foundLang ?? null;
}

/**
 * This is slightly modified list taken from fastlane: https://github.com/fastlane/fastlane/blob/master/spaceship/lib/assets/languageMapping.json
 * Currently supported languages can be found here: https://www.ibabbleon.com/iOS-Language-Codes-ISO-639.html
 */
const LANGUAGES: Language[] = [
  {
    locale: 'ar-SA',
    name: 'Arabic',
    itcLocale: 'ar-SA',
  },
  {
    locale: 'ca-ES',
    name: 'Catalan',
    itcLocale: 'ca',
  },
  {
    locale: 'cmn-Hans',
    name: 'Simplified Chinese',
    itcLocale: 'zh-Hans',
  },
  {
    locale: 'cmn-Hant',
    name: 'Traditional Chinese',
    itcLocale: 'zh-Hant',
  },
  {
    locale: 'cs-CZ',
    name: 'Czech',
    itcLocale: 'cs',
  },
  {
    locale: 'da-DK',
    name: 'Danish',
    itcLocale: 'da',
  },
  {
    locale: 'nl-NL',
    name: 'Dutch',
  },
  {
    locale: 'en-AU',
    name: 'English_Australian',
    displayName: 'Australian English',
  },
  {
    locale: 'en-CA',
    name: 'English_CA',
    displayName: 'Canadian English',
  },
  {
    locale: 'en-GB',
    name: 'English_UK',
    displayName: 'UK English',
  },
  {
    locale: 'en-US',
    name: 'English',
  },
  {
    locale: 'fi-FI',
    name: 'Finnish',
    itcLocale: 'fin',
  },
  {
    locale: 'fr-CA',
    name: 'French_CA',
    displayName: 'Canadian French',
  },
  {
    locale: 'fr-FR',
    name: 'French',
  },
  {
    locale: 'de-DE',
    name: 'German',
  },
  {
    locale: 'el-GR',
    name: 'Greek',
    itcLocale: 'el',
  },
  {
    locale: 'he',
    name: 'Hebrew',
    itcLocale: 'he',
  },
  {
    locale: 'hi-IN',
    name: 'Hindi',
    itcLocale: 'hi',
  },
  {
    locale: 'hr-HR',
    name: 'Croatian',
    itcLocale: 'hr',
  },
  {
    locale: 'hu-HU',
    name: 'Hungarian',
    itcLocale: 'hu',
  },
  {
    locale: 'id-ID',
    name: 'Indonesian',
    itcLocale: 'id',
  },
  {
    locale: 'it-IT',
    name: 'Italian',
    itcLocale: 'it',
  },
  {
    locale: 'ja-JP',
    name: 'Japanese',
    itcLocale: 'ja',
  },
  {
    locale: 'ko-KR',
    name: 'Korean',
    itcLocale: 'ko',
  },
  {
    locale: 'ms-MY',
    name: 'Malay',
    itcLocale: 'ms',
  },
  {
    locale: 'no-NO',
    name: 'Norwegian',
    itcLocale: 'no',
  },
  {
    locale: 'pl-PL',
    name: 'Polish',
    itcLocale: 'pl',
  },
  {
    locale: 'pt-BR',
    name: 'Brazilian Portuguese',
  },
  {
    locale: 'pt-PT',
    name: 'Portuguese',
  },
  {
    locale: 'ro-RO',
    name: 'Romanian',
    itcLocale: 'ro',
  },
  {
    locale: 'ru-RU',
    name: 'Russian',
    itcLocale: 'ru',
  },
  {
    locale: 'es-MX',
    name: 'Spanish_MX',
    displayName: 'Mexican Spanish',
  },
  {
    locale: 'es-ES',
    name: 'Spanish',
  },
  {
    locale: 'sk-SK',
    name: 'Slovak',
    itcLocale: 'sk',
  },
  {
    locale: 'sv-SE',
    name: 'Swedish',
    itcLocale: 'sv',
  },
  {
    locale: 'th-TH',
    name: 'Thai',
    itcLocale: 'th',
  },
  {
    locale: 'tr-TR',
    name: 'Turkish',
    itcLocale: 'tr',
  },
  {
    locale: 'uk-UA',
    name: 'Ukrainian',
    itcLocale: 'uk',
  },
  {
    locale: 'vi-VI',
    name: 'Vietnamese',
    itcLocale: 'vi',
  },
];
