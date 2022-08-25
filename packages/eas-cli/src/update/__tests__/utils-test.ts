import { getPlatformsForGroup } from '../utils';

describe(getPlatformsForGroup.name, () => {
  it.each([
    { group: 'abc', updates: [] },
    { group: '', updates: [] },
    { group: undefined, updates: [] },
    { group: undefined, updates: undefined },
    { group: 'asdf', updates: undefined },
  ])(`returns 'N/A' updates are undefined or empty`, input => {
    expect(getPlatformsForGroup(input)).toEqual(`N/A`);
  });
});
