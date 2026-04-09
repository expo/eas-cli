import {
  AppCategoryId,
  AppSubcategoryId,
  PhasedReleaseState,
  ReleaseType,
} from '@expo/apple-utils';

import { leastRestrictiveAdvisory, mostRestrictiveAdvisory } from './fixtures/ageRatingDeclaration';
import { AppleConfigReader } from '../reader';

describe('getCategories', () => {
  it('ignores categories when not set', () => {
    const reader = new AppleConfigReader({ categories: undefined });
    expect(reader.getCategories()).toBeNull();
  });

  it('returns primary category only', () => {
    const reader = new AppleConfigReader({ categories: [AppCategoryId.ENTERTAINMENT] });
    expect(reader.getCategories()).toMatchObject({
      primaryCategory: AppCategoryId.ENTERTAINMENT,
      secondaryCategory: undefined,
    });
  });

  it('returns primary and secondary categories', () => {
    const reader = new AppleConfigReader({
      categories: [AppCategoryId.ENTERTAINMENT, AppCategoryId.FOOD_AND_DRINK],
    });
    expect(reader.getCategories()).toMatchObject({
      primaryCategory: AppCategoryId.ENTERTAINMENT,
      secondaryCategory: AppCategoryId.FOOD_AND_DRINK,
    });
  });

  it('returns primary category without subcategory', () => {
    const reader = new AppleConfigReader({ categories: [AppCategoryId.GAMES] });
    expect(reader.getCategories()).toMatchObject({
      primaryCategory: AppCategoryId.GAMES,
      secondaryCategory: undefined,
    });
  });

  it('returns primary category with two subcategories', () => {
    const reader = new AppleConfigReader({
      categories: [
        [AppCategoryId.GAMES, AppSubcategoryId.GAMES_CARD, AppSubcategoryId.GAMES_ADVENTURE],
      ],
    });
    expect(reader.getCategories()).toMatchObject({
      primaryCategory: AppCategoryId.GAMES,
      primarySubcategoryOne: AppSubcategoryId.GAMES_CARD,
      primarySubcategoryTwo: AppSubcategoryId.GAMES_ADVENTURE,
      secondaryCategory: undefined,
    });
  });

  it('returns primary and secondary categories with two subcategories', () => {
    const reader = new AppleConfigReader({
      categories: [
        AppCategoryId.ENTERTAINMENT,
        [AppCategoryId.GAMES, AppSubcategoryId.GAMES_CARD, AppSubcategoryId.GAMES_ADVENTURE],
      ],
    });
    expect(reader.getCategories()).toMatchObject({
      primaryCategory: AppCategoryId.ENTERTAINMENT,
      secondaryCategory: AppCategoryId.GAMES,
      secondarySubcategoryOne: AppSubcategoryId.GAMES_CARD,
      secondarySubcategoryTwo: AppSubcategoryId.GAMES_ADVENTURE,
    });
    expect(reader.getCategories()).not.toHaveProperty('primarySubcategoryOne');
    expect(reader.getCategories()).not.toHaveProperty('primarySubcategoryTwo');
  });
});

describe('getAgeRating', () => {
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

describe('getVersionReleaseType', () => {
  it('ignores automatic release when not set', () => {
    const reader = new AppleConfigReader({ release: undefined });
    expect(reader.getVersionReleaseType()).toBeNull();
  });

  it('ignores automatic release when automaticRelease not set', () => {
    const reader = new AppleConfigReader({ release: {} });
    expect(reader.getVersionReleaseType()).toBeNull();
  });

  it('returns scheduled release date with iso string', () => {
    const reader = new AppleConfigReader({
      release: { automaticRelease: '2020-06-17T12:00:00-00:00' },
    });
    expect(reader.getVersionReleaseType()).toMatchObject({
      releaseType: ReleaseType.SCHEDULED,
      earliestReleaseDate: '2020-06-17T12:00:00.000Z',
    });
  });

  it('returns scheduled release with unparsable date string', () => {
    const reader = new AppleConfigReader({ release: { automaticRelease: '2020-06-17-12:00:00' } });
    expect(reader.getVersionReleaseType()).toMatchObject({
      releaseType: ReleaseType.SCHEDULED,
      earliestReleaseDate: '2020-06-17-12:00:00',
    });
  });

  it('returns automatic release', () => {
    const reader = new AppleConfigReader({ release: { automaticRelease: true } });
    expect(reader.getVersionReleaseType()).toMatchObject({
      releaseType: ReleaseType.AFTER_APPROVAL,
      earliestReleaseDate: null,
    });
  });

  it('returns manual release', () => {
    const reader = new AppleConfigReader({ release: { automaticRelease: false } });
    expect(reader.getVersionReleaseType()).toMatchObject({
      releaseType: ReleaseType.MANUAL,
      earliestReleaseDate: null,
    });
  });
});

describe('getVersionReleasePhased', () => {
  it('ignores phased release when not set', () => {
    const reader = new AppleConfigReader({ release: undefined });
    expect(reader.getVersionReleasePhased()).toBeNull();
  });

  it('ignores phased release when phasedRelease not set', () => {
    const reader = new AppleConfigReader({ release: {} });
    expect(reader.getVersionReleasePhased()).toBeNull();
  });

  it('returns phased release when enabled', () => {
    const reader = new AppleConfigReader({ release: { phasedRelease: true } });
    expect(reader.getVersionReleasePhased()).toMatchObject({
      phasedReleaseState: PhasedReleaseState.ACTIVE,
    });
  });

  it('ignores phased release when disabled', () => {
    const reader = new AppleConfigReader({ release: { phasedRelease: false } });
    expect(reader.getVersionReleasePhased()).toBeNull();
  });
});

describe('getVersion', () => {
  it('ignores version when not set', () => {
    const reader = new AppleConfigReader({});
    expect(reader.getVersion()).toBeNull();
  });

  it('returns version and copyright when set', () => {
    const reader = new AppleConfigReader({
      version: '2.0',
      copyright: '2022 - ACME',
    });
    expect(reader.getVersion()).toMatchObject({
      versionString: '2.0',
      copyright: '2022 - ACME',
    });
  });
});

describe('getAppClip', () => {
  it('returns null when no app clip is configured', () => {
    const reader = new AppleConfigReader({});
    expect(reader.getAppClip()).toBeNull();
    expect(reader.getAppClipDefaultExperience()).toBeNull();
    expect(reader.getAppClipLocales()).toEqual([]);
  });

  it('returns the configured app clip block', () => {
    const reader = new AppleConfigReader({
      appClip: {
        defaultExperience: {
          action: 'OPEN',
          releaseWithAppStoreVersion: true,
          reviewDetail: { invocationUrls: ['https://example.com/clip'] },
          info: {
            'en-US': { subtitle: 'Quick experience', headerImage: 'header.png' },
            'fr-FR': { subtitle: 'Expérience rapide' },
          },
        },
      },
    });

    expect(reader.getAppClipDefaultExperience()).toMatchObject({
      action: 'OPEN',
      releaseWithAppStoreVersion: true,
      reviewDetail: { invocationUrls: ['https://example.com/clip'] },
    });
    expect(reader.getAppClipLocales().sort()).toEqual(['en-US', 'fr-FR']);
    expect(reader.getAppClipLocalizedInfo('en-US')).toEqual({
      subtitle: 'Quick experience',
      headerImage: 'header.png',
    });
    expect(reader.getAppClipLocalizedInfo('fr-FR')).toEqual({
      subtitle: 'Expérience rapide',
    });
    expect(reader.getAppClipLocalizedInfo('de-DE')).toBeNull();
  });
});
