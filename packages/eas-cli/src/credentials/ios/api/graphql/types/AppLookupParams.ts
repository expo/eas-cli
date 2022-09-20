import { AccountFragment } from '../../../../../graphql/generated';

export interface AppLookupParams {
  account: AccountFragment;
  projectName: string;
  bundleIdentifier: string;
  parentBundleIdentifier?: string;
}
