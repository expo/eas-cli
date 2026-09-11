import { getProxiedDownloadUrl } from '../download';

describe(getProxiedDownloadUrl, () => {
  it('returns null when no proxy base URL is set', () => {
    expect(
      getProxiedDownloadUrl({ directUrl: 'https://storage.googleapis.com/bucket/object' })
    ).toBeNull();
  });

  it('rewrites the origin to the proxy base URL', () => {
    expect(
      getProxiedDownloadUrl({
        directUrl: 'https://storage.googleapis.com/bucket/object',
        proxyBaseUrl: 'https://cache.example.com',
      })
    ).toBe('https://cache.example.com/storage.googleapis.com/bucket/object');
  });

  it('normalizes a proxy base URL with a trailing slash', () => {
    expect(
      getProxiedDownloadUrl({
        directUrl: 'https://storage.googleapis.com/bucket/object',
        proxyBaseUrl: 'https://cache.example.com/',
      })
    ).toBe('https://cache.example.com/storage.googleapis.com/bucket/object');
  });
});
