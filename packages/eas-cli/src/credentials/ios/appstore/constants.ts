// Renamed to avoid conflation with Android/iOS/Web Platform constants
export { Platform as ApplePlatform } from '@expo/apple-utils';

/**
 * How long the App Store Connect API key JWTs we sign stay valid. Apple rejects tokens that live
 * 20 minutes (1200 s) or more by its own clock, so signing at exactly 1200 s fails with a 401
 * whenever the local clock is even a second ahead of Apple's. A minute of margin absorbs that skew.
 */
export const ASC_API_KEY_TOKEN_DURATION_SECONDS = 1140;
