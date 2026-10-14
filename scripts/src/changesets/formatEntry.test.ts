import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatEntry } from '../../../.changeset/formatEntry.mjs';

const ATTRIBUTION =
  '([#1](https://github.com/expo/eas-cli/pull/1) by [@user](https://github.com/user))';

describe(formatEntry.name, () => {
  it('capitalizes the summary, adds a period, and appends the attribution', () => {
    assert.equal(formatEntry('add a flag', ATTRIBUTION), `Add a flag. ${ATTRIBUTION}`);
  });

  it('keeps an existing period', () => {
    assert.equal(formatEntry('Add a flag.', ATTRIBUTION), `Add a flag. ${ATTRIBUTION}`);
  });

  it('trims surrounding whitespace', () => {
    assert.equal(formatEntry('\n  Add a flag  \n\n', ATTRIBUTION), `Add a flag. ${ATTRIBUTION}`);
  });

  it('indents later lines and keeps blank lines', () => {
    assert.equal(
      formatEntry('Add a flag\n\nDetails here.\n- item', ATTRIBUTION),
      `Add a flag. ${ATTRIBUTION}\n\n  Details here.\n  - item`
    );
  });

  it('throws on an empty summary', () => {
    assert.throws(() => formatEntry('  \n ', ATTRIBUTION), /summary is empty/);
  });
});
