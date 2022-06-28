import { AppleConfigReader } from '../reader';
import { leastRestrictiveAdvisory, mostRestrictiveAdvisory } from './fixtures/ageRatingDeclaration';

describe('setAgeRating', () => {
  it('ignores advisory when not set', () => {
    const reader = new AppleConfigReader({ advisory: undefined });
    expect(reader.getAgeRating()).toBeNull();
  });

  it('auto-fills least restrictive advisory', () => {
    const reader = new AppleConfigReader({ advisory: {} });
    expect(reader.getAgeRating()).toMatchObject(leastRestrictiveAdvisory);
  });

  it('returns most restrictive advisory', () => {
    const reader = new AppleConfigReader({ advisory: mostRestrictiveAdvisory });
    expect(reader.getAgeRating()).toMatchObject(mostRestrictiveAdvisory);
  });
});
