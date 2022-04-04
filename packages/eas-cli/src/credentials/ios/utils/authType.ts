import { RequestContext } from '@expo/apple-utils';

/** Is the request context App Store Connect only with no access to cookies authentication. */
// todo: perhaps good to differentiate jwt vs cookies authentication upstream?
export function isAppStoreConnectTokenOnlyContext(authContext: RequestContext): boolean {
  return !authContext.teamId && !!authContext.token;
}
