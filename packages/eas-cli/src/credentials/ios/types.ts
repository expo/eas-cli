import { JSONObject } from '@expo/json-file';
import type { XCBuildConfiguration } from 'xcode';
import { z } from 'zod';

import {
  AccountFragment,
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
} from '../../graphql/generated';

export interface App {
  account: AccountFragment;
  projectName: string;
}

export interface Target {
  targetName: string;
  buildConfiguration?: string;
  bundleIdentifier: string;
  parentBundleIdentifier?: string;
  entitlements: JSONObject;
  buildSettings?: XCBuildConfiguration['buildSettings'];
}

export interface TargetCredentials {
  distributionCertificate: {
    certificateP12: string;
    certificatePassword: string;
  };
  provisioningProfile: string;
}

export type IosCredentials = Record<string, TargetCredentials>;

export type IosAppBuildCredentialsMap = Record<string, IosAppBuildCredentialsFragment>;
export type IosAppCredentialsMap = Record<string, CommonIosAppCredentialsFragment | null>;
// `z.coerce.boolean()` does `Boolean(val)` under the hood,
// which is not what we want. See:
// https://github.com/colinhacks/zod/issues/2985#issuecomment-2230692578

export const booleanLike = z.union([
  z.boolean(),
  z.codec(z.number(), z.boolean(), {
    decode: n => !!n,
    encode: b => (b ? 1 : 0),
  }),
  z.stringbool({ truthy: ['true', 'True'], falsy: ['false', 'False'] }),
]);

export const stringLike = z.codec(
  z.union([
    // We're going to coerce numbers and strings into strings.
    z.number(),
    z.string(),
    // We do not allow other primitives, like:
    // - bigints, symbols - because YAML does not support them,
    // - booleans - because YAML accepts `True` and `true` as boolean input
    //   and parses both as JS `true` -- if we stringified that,
    //   we would lose the capital "T" which may not be what the user expects,
    // - nulls - user should do `"null"` or not pass the property at all.
  ]),
  z.string(),
  {
    decode: value => {
      if (typeof value === 'string') {
        return value;
      }
      if (typeof value === 'number') {
        return String(value);
      }
      throw new Error(`Cannot convert ${typeof value} to string: ${value}`);
    },
    encode: value => value,
  }
);
