import { EasPaginatedQueryFlags, getLimitFlagWithCustomValues } from '../pagination';

async function parseFlagAsync(flag: { parse?: any }, input: string): Promise<number> {
  return await flag.parse(input, {}, {});
}

describe(getLimitFlagWithCustomValues, () => {
  const limit = getLimitFlagWithCustomValues({ defaultTo: 50, limit: 100 });

  it('accepts integers within the range', async () => {
    await expect(parseFlagAsync(limit, '1')).resolves.toBe(1);
    await expect(parseFlagAsync(limit, '100')).resolves.toBe(100);
  });

  it('rejects values outside the range', async () => {
    await expect(parseFlagAsync(limit, '0')).rejects.toThrow('--limit must be between 1 and 100');
    await expect(parseFlagAsync(limit, '101')).rejects.toThrow('--limit must be between 1 and 100');
  });

  it('rejects non-integer input instead of passing it to the server', async () => {
    await expect(parseFlagAsync(limit, '1.5')).rejects.toThrow('Unable to parse 1.5 as an integer');
    await expect(parseFlagAsync(limit, 'ten')).rejects.toThrow('Unable to parse ten as an integer');
  });
});

describe('EasPaginatedQueryFlags.offset', () => {
  it('accepts zero and rejects non-integers', async () => {
    await expect(parseFlagAsync(EasPaginatedQueryFlags.offset, '0')).resolves.toBe(0);
    await expect(parseFlagAsync(EasPaginatedQueryFlags.offset, '2.5')).rejects.toThrow(
      'Unable to parse 2.5 as an integer'
    );
  });
});
