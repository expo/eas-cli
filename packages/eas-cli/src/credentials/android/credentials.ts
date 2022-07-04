import { AndroidKeystoreType } from '../../graphql/generated.js';
import { CredentialSchema } from '../utils/promptForCredentials.js';

export interface FcmCredentials {
  fcmApiKey: string;
}

export interface Keystore {
  keystore: string;
  keystorePassword: string;
  keyAlias: string;
  keyPassword?: string;
}

export type KeystoreWithType = Keystore & {
  type: AndroidKeystoreType;
};

export type GoogleServiceAccountKey = {
  [key: string]: any;
  private_key: string;
  type: string;
  client_email: string;
};

export type AndroidCredentials = {
  experienceName: string;
  keystore: Keystore | null;
  pushCredentials: FcmCredentials | null;
};

export const keystoreSchema: CredentialSchema<Keystore> = {
  name: 'Android Keystore',
  provideMethodQuestion: {
    question: `Generate a new Android Keystore?`,
  },
  questions: [
    {
      field: 'keystore',
      question: 'Path to the Keystore file.',
      type: 'file',
      base64Encode: true,
    },
    {
      field: 'keystorePassword',
      question: 'Keystore password',
      type: 'password',
    },
    {
      field: 'keyAlias',
      question: 'Key alias',
      type: 'string',
    },
    {
      field: 'keyPassword',
      question: 'Key password',
      type: 'password',
    },
  ],
};
