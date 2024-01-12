import { AppCategoryId, AppSubcategoryId } from '@expo/apple-utils';

import {
  emptyAdvisory,
  kidsSixToEightAdvisory,
  leastRestrictiveAdvisory,
  mostRestrictiveAdvisory,
} from './fixtures/ageRatingDeclaration';
import { makeCategoryInfo } from './fixtures/appInfo';
import { dutchInfo, englishInfo } from './fixtures/appInfoLocalization';
import { nameAndDemoReviewDetails, nameOnlyReviewDetails } from './fixtures/appStoreReviewDetail';
import { automaticRelease, manualRelease, scheduledRelease } from './fixtures/appStoreVersion';
import { dutchVersion, englishVersion } from './fixtures/appStoreVersionLocalization';
import { phasedRelease } from './fixtures/appStoreVersionPhasedRelease';
import { AppleConfigWriter } from '../writer';

describe('toSchema', () => {
  it('returns object with apple schema', () => {
    const writer = new AppleConfigWriter();
    expect(writer.toSchema()).toMatchObject({
      configVersion: 0,
      apple: expect.any(Object),
    });
  });
});

describe('setAgeRating', () => {
  it('auto-fills least restrictive advisory', () => {
    const writer = new AppleConfigWriter();
    writer.setAgeRating(emptyAdvisory);
    expect(writer.schema.advisory).toMatchObject(leastRestrictiveAdvisory);
  });

  it('modifies kids band rating', () => {
    const writer = new AppleConfigWriter();
    writer.setAgeRating(kidsSixToEightAdvisory);
    expect(writer.schema.advisory).toMatchObject(kidsSixToEightAdvisory);
  });

  it('modifies most restrictive advisory', () => {
    const writer = new AppleConfigWriter();
    writer.setAgeRating(mostRestrictiveAdvisory);
    expect(writer.schema.advisory).toMatchObject(mostRestrictiveAdvisory);
  });
});

describe('setInfoLocale', () => {
  it('creates and modifies the locale', () => {
    const writer = new AppleConfigWriter();
    writer.setInfoLocale(englishInfo);
    expect(writer.schema.info?.[englishInfo.locale]).toMatchObject({
      title: englishInfo.name,
      subtitle: englishInfo.subtitle,
      privacyPolicyUrl: englishInfo.privacyPolicyUrl,
      privacyPolicyText: englishInfo.privacyPolicyText,
      privacyChoicesUrl: englishInfo.privacyChoicesUrl,
    });
  });

  it('modifies existing locales', () => {
    const writer = new AppleConfigWriter();
    writer.setInfoLocale(englishInfo);
    writer.setInfoLocale(dutchInfo);
    writer.setInfoLocale({
      ...englishInfo,
      name: 'This is now different',
      privacyPolicyText: null,
    });

    expect(writer.schema.info?.[dutchInfo.locale]).toHaveProperty('title', dutchInfo.name);
    expect(writer.schema.info?.[englishInfo.locale]).toMatchObject({
      title: 'This is now different',
      privacyPolicyText: undefined,
    });
  });
});

describe('setCategories', () => {
  it('skips secondary category without primary category', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(makeCategoryInfo({}));
    expect(writer.schema.categories).toBeUndefined();
  });

  it('removes existing values when undefined', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(makeCategoryInfo({ primaryCategory: AppCategoryId.BUSINESS }));
    writer.setCategories(makeCategoryInfo({}));
    expect(writer.schema.categories).toBeUndefined();
  });

  it('modifies primary category only', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(makeCategoryInfo({ primaryCategory: AppCategoryId.ENTERTAINMENT }));
    expect(writer.schema.categories).toEqual([AppCategoryId.ENTERTAINMENT]);
  });

  it('modifies primary and secondary categories', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(
      makeCategoryInfo({
        primaryCategory: AppCategoryId.ENTERTAINMENT,
        secondaryCategory: AppCategoryId.FOOD_AND_DRINK,
      })
    );
    expect(writer.schema.categories).toEqual([
      AppCategoryId.ENTERTAINMENT,
      AppCategoryId.FOOD_AND_DRINK,
    ]);
  });

  it('modifies primary category without subcategories', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(makeCategoryInfo({ primaryCategory: AppCategoryId.GAMES }));
    expect(writer.schema.categories).toEqual([AppCategoryId.GAMES]);
  });

  it('modifies primary category with one subcategories', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(
      makeCategoryInfo({
        primaryCategory: AppCategoryId.GAMES,
        primarySubcategoryOne: AppSubcategoryId.GAMES_CARD,
      })
    );
    expect(writer.schema.categories).toEqual([[AppCategoryId.GAMES, AppSubcategoryId.GAMES_CARD]]);
    // We need to filter the lists to avoid writing `[GAMES, GAMES_CARD, null]`
    expect(writer.schema.categories![0]).toHaveLength(2);
  });

  it('modifies primary category with two subcategories', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(
      makeCategoryInfo({
        primaryCategory: AppCategoryId.GAMES,
        primarySubcategoryOne: AppSubcategoryId.GAMES_CARD,
        primarySubcategoryTwo: AppSubcategoryId.GAMES_ADVENTURE,
      })
    );
    expect(writer.schema.categories).toEqual([
      [AppCategoryId.GAMES, AppSubcategoryId.GAMES_CARD, AppSubcategoryId.GAMES_ADVENTURE],
    ]);
  });

  it('modifies primary and secondary categories with one subcategories', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(
      makeCategoryInfo({
        primaryCategory: AppCategoryId.ENTERTAINMENT,
        secondaryCategory: AppCategoryId.GAMES,
        secondarySubcategoryOne: AppSubcategoryId.GAMES_CARD,
      })
    );
    expect(writer.schema.categories).toEqual([
      AppCategoryId.ENTERTAINMENT,
      [AppCategoryId.GAMES, AppSubcategoryId.GAMES_CARD],
    ]);
    // We need to filter the lists to avoid writing `[GAMES, GAMES_CARD, null]`
    expect(writer.schema.categories![1]).toHaveLength(2);
  });

  it('modifies primary and secondary categories with two subcategories', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(
      makeCategoryInfo({
        primaryCategory: AppCategoryId.ENTERTAINMENT,
        secondaryCategory: AppCategoryId.GAMES,
        secondarySubcategoryOne: AppSubcategoryId.GAMES_CARD,
        secondarySubcategoryTwo: AppSubcategoryId.GAMES_ADVENTURE,
      })
    );
    expect(writer.schema.categories).toEqual([
      AppCategoryId.ENTERTAINMENT,
      [AppCategoryId.GAMES, AppSubcategoryId.GAMES_CARD, AppSubcategoryId.GAMES_ADVENTURE],
    ]);
  });

  it('modifies secondary category without primary', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(makeCategoryInfo({ secondaryCategory: AppCategoryId.GAMES }));
    expect(writer.schema.categories).toEqual(['', AppCategoryId.GAMES]);
  });
});

describe('setVersion', () => {
  it('modifies the copyright and version string', () => {
    const writer = new AppleConfigWriter();
    writer.setVersion(manualRelease);
    expect(writer.schema.version).toBe(manualRelease.versionString);
    expect(writer.schema.copyright).toBe(manualRelease.copyright);
  });
});

describe('setVersionReleaseType', () => {
  it('modifies scheduled release', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionReleaseType(scheduledRelease);
    expect(writer.schema.release).toMatchObject({
      automaticRelease: scheduledRelease.earliestReleaseDate,
    });
  });

  it('modifies automatic release', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionReleaseType(automaticRelease);
    expect(writer.schema.release).toMatchObject({
      automaticRelease: true,
    });
  });

  it('modifies manual release', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionReleaseType(manualRelease);
    expect(writer.schema.release).toMatchObject({
      automaticRelease: false,
    });
  });

  it('does not overwrite phasedRelease', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionReleasePhased(phasedRelease);
    writer.setVersionReleaseType(manualRelease);
    expect(writer.schema.release).toMatchObject({
      automaticRelease: false,
      phasedRelease: true,
    });
  });
});

describe('setVersionReleasePhased', () => {
  it('modifies enabled phased release', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionReleasePhased(phasedRelease);
    expect(writer.schema.release).toHaveProperty('phasedRelease', true);
  });

  it('deletes phased release when undefined', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionReleasePhased(phasedRelease);
    writer.setVersionReleasePhased(undefined);
    expect(writer.schema.release).not.toHaveProperty('phasedRelease');
  });

  it('does not overwrite automaticRelease', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionReleaseType(automaticRelease);
    writer.setVersionReleasePhased(phasedRelease);
    expect(writer.schema.release).toMatchObject({
      automaticRelease: true,
      phasedRelease: true,
    });
  });
});

describe('setVersionLocale', () => {
  it('creates and modifies the locale', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionLocale(englishVersion);
    expect(writer.schema.info?.[englishVersion.locale]).toMatchObject({
      description: englishVersion.description,
      keywords: englishVersion.keywords?.split(', '),
      releaseNotes: englishVersion.whatsNew,
      marketingUrl: englishVersion.marketingUrl,
      promoText: englishVersion.promotionalText,
      supportUrl: englishVersion.supportUrl,
    });
  });

  it('modifies existing locales', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionLocale(englishVersion);
    writer.setVersionLocale(dutchVersion);
    writer.setVersionLocale({
      ...englishVersion,
      description: 'This is now different',
      whatsNew: null,
    });

    expect(writer.schema.info?.[dutchVersion.locale]).toHaveProperty(
      'description',
      dutchVersion.description
    );
    expect(writer.schema.info?.[englishVersion.locale]).toMatchObject({
      description: 'This is now different',
      releaseNotes: undefined,
    });
  });
});

describe('setReviewDetails', () => {
  it('modifies name only review details', () => {
    const writer = new AppleConfigWriter();
    writer.setReviewDetails(nameOnlyReviewDetails);
    expect(writer.schema.review).toMatchObject({
      firstName: nameOnlyReviewDetails.contactFirstName,
      lastName: nameOnlyReviewDetails.contactLastName,
      email: nameOnlyReviewDetails.contactEmail,
      phone: nameOnlyReviewDetails.contactPhone,
      demoUsername: undefined,
      demoPassword: undefined,
      demoRequired: undefined,
      notes: undefined,
    });
  });

  it('modifies name and demo review details', () => {
    const writer = new AppleConfigWriter();
    writer.setReviewDetails(nameAndDemoReviewDetails);
    expect(writer.schema.review).toMatchObject({
      firstName: nameAndDemoReviewDetails.contactFirstName,
      lastName: nameAndDemoReviewDetails.contactLastName,
      email: nameAndDemoReviewDetails.contactEmail,
      phone: nameAndDemoReviewDetails.contactPhone,
      demoUsername: nameAndDemoReviewDetails.demoAccountName,
      demoPassword: nameAndDemoReviewDetails.demoAccountPassword,
      demoRequired: nameAndDemoReviewDetails.demoAccountRequired,
      notes: undefined,
    });
  });

  it('replaces existing review details', () => {
    const writer = new AppleConfigWriter();
    writer.setReviewDetails(nameAndDemoReviewDetails);
    writer.setReviewDetails(nameOnlyReviewDetails);
    expect(writer.schema.review).toMatchObject({
      demoUsername: undefined,
      demoPassword: undefined,
      demoRequired: undefined,
    });
  });
});
