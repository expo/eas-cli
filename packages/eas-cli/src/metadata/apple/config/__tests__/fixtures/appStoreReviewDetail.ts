import { AppStoreReviewDetail } from '@expo/apple-utils';

import { AttributesOf } from '../../../../utils/asc';

export const nameOnlyReviewDetails: AttributesOf<AppStoreReviewDetail> = {
  contactFirstName: 'Evan',
  contactLastName: 'Bacon',
  contactEmail: 'apple@example.com',
  contactPhone: '+1 (555) 555-5555',
  demoAccountName: null,
  demoAccountPassword: null,
  demoAccountRequired: null,
  notes: null,
};

export const nameAndDemoReviewDetails: AttributesOf<AppStoreReviewDetail> = {
  contactFirstName: 'Evan',
  contactLastName: 'Bacon',
  contactEmail: 'apple@example.com',
  contactPhone: '+1 (555) 555-5555',
  demoAccountName: 'demo@apple.com',
  demoAccountPassword: 'secretpassword',
  demoAccountRequired: true,
  notes: null,
};
