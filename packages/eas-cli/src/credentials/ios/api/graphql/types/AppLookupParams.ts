import { Account } from '../../../../../user/Account';

export interface AppLookupParams {
  account: Account;
  projectName: string;
  bundleIdentifier: string;
  parentBundleIdentifier?: string;
}
