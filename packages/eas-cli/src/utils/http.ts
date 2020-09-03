import got from 'got';

export const apiClient = got.extend({
  prefixUrl: getExpoApiBaseUrl() + '/--/api/v2/',
  responseType: 'json',
});

export function getExpoApiBaseUrl(): string {
  if (process.env.EXPO_STAGING) {
    return `https://staging.expo.io`;
  } else if (process.env.EXPO_LOCAL) {
    return `http://expo.test`;
  } else {
    return `https://expo.io`;
  }
}
