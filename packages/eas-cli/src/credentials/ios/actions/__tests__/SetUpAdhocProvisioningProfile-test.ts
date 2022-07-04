import { doUDIDsMatch } from '../SetUpAdhocProvisioningProfile.js';

describe(doUDIDsMatch, () => {
  it('return false if UDIDs do not match', () => {
    const udidsA: string[] = ['00001111-001122334455662E', '11110000-771122334455662E'];
    const udidsB: string[] = ['34330000-771122334455662E', '00001111-001122334455662E'];
    expect(doUDIDsMatch(udidsA, udidsB)).toBe(false);
  });
  it('return true if UDIDs match', () => {
    const udidsA: string[] = ['00001111-001122334455662E', '11110000-771122334455662E'];
    const udidsB: string[] = ['11110000-771122334455662E', '00001111-001122334455662E'];
    expect(doUDIDsMatch(udidsA, udidsB)).toBe(true);
  });
});
