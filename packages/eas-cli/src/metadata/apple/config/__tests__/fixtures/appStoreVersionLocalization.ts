import AppleUtils from '@expo/apple-utils';

import { AttributesOf } from '../../../../utils/asc.js';

export const englishVersion: AttributesOf<AppleUtils.AppStoreVersionLocalization> = {
  locale: 'en-US',
  description: 'This is a description of this version',
  keywords: 'some, description',
  marketingUrl: 'https://example.com/en/marketing',
  promotionalText: 'This is some promotional text',
  supportUrl: 'https://example.com/en/support',
  whatsNew: 'Bugfixes and improvements',
};

export const dutchVersion: AttributesOf<AppleUtils.AppStoreVersionLocalization> = {
  locale: 'nl-NL',
  description: 'Dit is een beschrijving van deze versie',
  keywords: 'een, beschrijving',
  marketingUrl: 'https://example.com/nl/marketing',
  promotionalText: 'Dit is wat promotie tekst',
  supportUrl: 'https://example.com/nl/support',
  whatsNew: 'Beestreparaties en verbeteringen',
};
