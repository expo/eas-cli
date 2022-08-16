import { AppInfoLocalization } from '@expo/apple-utils';

import { AttributesOf } from '../../../../utils/asc';

export const englishInfo: AttributesOf<AppInfoLocalization> = {
  locale: 'en-US',
  name: 'Awesome test app',
  subtitle: 'This is just a test',
  privacyPolicyUrl: 'https://example.com/en/privacy-policy',
  privacyChoicesUrl: 'https://exmaple.com/en/privacy-choices',
  privacyPolicyText: 'This is some privacy policy text',
};

export const dutchInfo: AttributesOf<AppInfoLocalization> = {
  locale: 'nl-NL',
  name: 'Geweldige test app',
  subtitle: 'Dit is maar een test',
  privacyPolicyUrl: 'https://example.com/nl/privacy-policy',
  privacyChoicesUrl: 'https://example.com/nl/privacy-choices',
  privacyPolicyText: 'Dit is wat privacy policy tekst',
};
