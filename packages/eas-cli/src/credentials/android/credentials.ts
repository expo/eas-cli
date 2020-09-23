import { CredentialSchema } from '../utils/promptForCredentials';

export interface FcmCredentials {
  fcmApiKey: string;
}

export interface Keystore {
  keystore: string;
  keystorePassword: string;
  keyAlias: string;
  keyPassword: string;
}

export type AndroidCredentials = {
  experienceName: string;
  keystore: Keystore | null;
  pushCredentials: FcmCredentials | null;
};

export const keystoreSchema: CredentialSchema<Keystore> = {
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
