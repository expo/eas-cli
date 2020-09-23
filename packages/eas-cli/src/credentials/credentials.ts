import { AndroidCredentials as Android } from '@expo/xdl';

import { CredentialSchema } from './actions/promptForCredentials';


export type FcmCredentials = {
  fcmApiKey: string;
};

export type Keystore = Android.Keystore;

export type AndroidCredentials = {
  experienceName: string;
  keystore: Keystore | null;
  pushCredentials: FcmCredentials | null;
};

export const keystoreSchema: CredentialSchema<Android.Keystore> = {
  id: 'keystore',
  name: 'Android Keystore',
  provideMethodQuestion: {
    question: `Would you like to upload a Keystore or have us generate one for you?\nIf you don't know what this means, let us generate it! :)`,
    expoGenerated: 'Generate new keystore',
    userProvided: 'I want to upload my own file',
  },
  required: ['keystore', 'keystorePassword', 'keyAlias', 'keyPassword'],
  questions: {
    keystore: {
      question: 'Path to the Keystore file.',
      type: 'file',
      base64Encode: true,
    },
    keystorePassword: {
      question: 'Keystore password',
      type: 'password',
    },
    keyAlias: {
      question: 'Key alias',
      type: 'string',
    },
    keyPassword: {
      question: 'Key password',
      type: 'password',
    },
  },
};

export const EXPO_WILL_GENERATE = 'EXPO_PLEASE_GENERATE_THIS_FOR_ME';
