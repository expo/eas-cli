import { createEmptyRecord } from '../record';

describe(createEmptyRecord, () => {
  it('creates a typed null-prototype record', () => {
    const record = createEmptyRecord<Record<'a' | 'b', number>>();
    record.a = 1;
    record.b = 2;

    expect(record).toEqual({ a: 1, b: 2 });
    expect(Object.getPrototypeOf(record)).toBeNull();
  });
});
