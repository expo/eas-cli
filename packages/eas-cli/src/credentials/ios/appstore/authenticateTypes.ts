import { Session } from '@expo/apple-utils';

import { MinimalAscApiKey } from '../credentials';

export enum AuthenticationMode {
  /** App Store API requests will be made using the official API via an API key, used for CI environments where 2FA cannot be performed. */
  API_KEY,
  /** Uses cookies based authentication and the unofficial App Store web API, this provides more functionality than the official API but cannot be reliably used in CI because it requires 2FA. */
  USER,
}

export enum AppleTeamType {
  IN_HOUSE = 'IN_HOUSE',
  COMPANY_OR_ORGANIZATION = 'COMPANY_OR_ORGANIZATION',
  INDIVIDUAL = 'INDIVIDUAL',
}

export type Team = {
  id: string;
  /** Name of the development team, this is undefined when ASC API keys are used instead of cookies for authentication. */
  name?: string;
  inHouse?: boolean;
};

export type UserAuthCtx = {
  appleId: string;
  appleIdPassword?: string;
  team: Team;
  /**
   * Defined when using Fastlane
   */
  fastlaneSession?: string;
  /**
   * Can be used to restore the Apple auth state via apple-utils.
   */
  authState?: Session.AuthState;
};

export type ApiKeyAuthCtx = {
  ascApiKey: MinimalAscApiKey;
  team: Team;
  /**
   * Can be used to restore the Apple auth state via apple-utils.
   */
  authState?: Partial<Session.AuthState>;
};

export type AuthCtx = UserAuthCtx | ApiKeyAuthCtx;
