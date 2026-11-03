import nock from 'nock';

import {
  getSurrealHealthUrl,
  isCleartextEndpoint,
  isSurrealEndpointReachableAsync,
  parseSurrealEndpoint,
  validateSurrealEndpoint,
  validateSurrealName,
} from '../endpoint';

jest.mock('../../../log');

describe(parseSurrealEndpoint, () => {
  it('keeps a full wss:// endpoint as it is', () => {
    expect(parseSurrealEndpoint('wss://my-instance.aws-euw1.surreal.cloud')).toBe(
      'wss://my-instance.aws-euw1.surreal.cloud'
    );
  });

  it('adds wss:// to a bare hostname', () => {
    expect(parseSurrealEndpoint('  my-instance.aws-euw1.surreal.cloud  ')).toBe(
      'wss://my-instance.aws-euw1.surreal.cloud'
    );
  });

  it('strips a trailing /rpc and trailing slashes, since the SDK appends /rpc', () => {
    expect(parseSurrealEndpoint('wss://db.example.com/rpc')).toBe('wss://db.example.com');
    expect(parseSurrealEndpoint('https://db.example.com/surreal/rpc/')).toBe(
      'https://db.example.com/surreal'
    );
    expect(parseSurrealEndpoint('ws://10.0.2.2:8000/')).toBe('ws://10.0.2.2:8000');
  });

  it('rejects unsupported protocols', () => {
    expect(() => parseSurrealEndpoint('ftp://db.example.com')).toThrow('Unsupported protocol');
  });

  it('rejects credentials in the URL, because the value ships in the app bundle', () => {
    expect(() => parseSurrealEndpoint('wss://root:root@db.example.com')).toThrow(
      'Do not put credentials in the endpoint'
    );
  });

  it('rejects query strings and fragments', () => {
    expect(() => parseSurrealEndpoint('wss://db.example.com?ns=app')).toThrow('query string');
  });

  it('rejects an empty value', () => {
    expect(() => parseSurrealEndpoint('   ')).toThrow('Pass a SurrealDB endpoint');
  });
});

describe(validateSurrealEndpoint, () => {
  it('returns true for a valid endpoint and the error message otherwise', () => {
    expect(validateSurrealEndpoint('db.example.com')).toBe(true);
    expect(validateSurrealEndpoint('ftp://db.example.com')).toEqual(
      expect.stringContaining('Unsupported protocol')
    );
  });
});

describe(validateSurrealName, () => {
  it('requires a non-blank value', () => {
    expect(validateSurrealName('namespace')('app')).toBe(true);
    expect(validateSurrealName('database')('  ')).toBe(
      'Enter the SurrealDB database the app should use.'
    );
  });
});

describe(isCleartextEndpoint, () => {
  it('flags ws:// and http:// only', () => {
    expect(isCleartextEndpoint('ws://10.0.2.2:8000')).toBe(true);
    expect(isCleartextEndpoint('http://127.0.0.1:8000')).toBe(true);
    expect(isCleartextEndpoint('wss://db.example.com')).toBe(false);
    expect(isCleartextEndpoint('https://db.example.com')).toBe(false);
  });
});

describe(getSurrealHealthUrl, () => {
  it('maps WebSocket protocols to their HTTP equivalents', () => {
    expect(getSurrealHealthUrl('wss://db.example.com')).toBe('https://db.example.com/health');
    expect(getSurrealHealthUrl('ws://10.0.2.2:8000')).toBe('http://10.0.2.2:8000/health');
    expect(getSurrealHealthUrl('https://db.example.com/surreal')).toBe(
      'https://db.example.com/surreal/health'
    );
  });
});

describe(isSurrealEndpointReachableAsync, () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('is true when /health answers', async () => {
    nock('https://db.example.com').get('/health').reply(200);

    await expect(isSurrealEndpointReachableAsync('wss://db.example.com')).resolves.toBe(true);
  });

  it('is false when /health fails', async () => {
    nock('https://db.example.com').get('/health').reply(503);

    await expect(isSurrealEndpointReachableAsync('wss://db.example.com')).resolves.toBe(false);
  });

  it('is false when the host cannot be reached', async () => {
    nock('https://db.example.com').get('/health').replyWithError('ECONNREFUSED');

    await expect(isSurrealEndpointReachableAsync('wss://db.example.com')).resolves.toBe(false);
  });
});
