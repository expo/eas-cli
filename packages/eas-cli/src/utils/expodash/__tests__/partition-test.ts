import { truthy } from '../filter';
import partition from '../partition';

describe(partition, () => {
  it('partitions', () => {
    expect(partition([true, false], truthy)).toMatchObject([[true], [false]]);

    expect(partition([1, 2, 3, 4], e => e <= 2)).toMatchObject([
      [1, 2],
      [3, 4],
    ]);
  });
});
