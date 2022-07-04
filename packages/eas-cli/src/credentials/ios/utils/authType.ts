import AppleUtils from '@expo/apple-utils';

/** Is the request context App Store Connect only with no access to cookies authentication. */
export function isAppStoreConnectTokenOnlyContext(authContext: AppleUtils.RequestContext): boolean {
  return !authContext.teamId && !!authContext.token;
}
