import { print } from 'graphql';

import { UpdateFragmentNode, UpdateWithFileUrlsFragmentNode } from '../Update';

const FILE_URL_FIELDS = ['assetMapUrl', 'sourceMapUrl'];

describe('UpdateFragment', () => {
  // The server signs each of these URLs per request, so list queries must not ask for them.
  it.each(FILE_URL_FIELDS)('does not request %s', field => {
    expect(print(UpdateFragmentNode)).not.toContain(field);
  });
});

describe('UpdateWithFileUrlsFragment', () => {
  it.each(FILE_URL_FIELDS)('requests %s', field => {
    expect(print(UpdateWithFileUrlsFragmentNode)).toContain(field);
  });

  it('builds on UpdateFragment rather than duplicating its fields', () => {
    const printed = print(UpdateWithFileUrlsFragmentNode);

    expect(printed).toContain('...UpdateFragment');
    expect(printed).toContain('fragment UpdateFragment on Update');
  });
});
