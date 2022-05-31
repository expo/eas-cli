import { AppleConfigWriter } from '../writer';
import { kidsSixToEightAdvisory } from './fixtures/ageRatingDeclaration';
import { primaryAndSecondaryCategory, secondaryOnlyCategory } from './fixtures/appInfo';
import { dutchInfo, englishInfo } from './fixtures/appInfoLocalization';
import { automaticRelease, manualRelease, scheduledRelease } from './fixtures/appStoreVersion';
import { dutchVersion, englishVersion } from './fixtures/appStoreVersionLocalization';

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
  it('modifies the advisory', () => {
    const writer = new AppleConfigWriter();
    writer.setAgeRating(kidsSixToEightAdvisory);
    expect(writer.schema.advisory).toMatchObject(kidsSixToEightAdvisory);
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
  it('modifies the categories', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(primaryAndSecondaryCategory as any);
    expect(writer.schema.categories).toHaveLength(2);
    expect((writer.schema.categories as any)[0]).toBe(
      primaryAndSecondaryCategory.primaryCategory?.id
    );
    expect((writer.schema.categories as any)[1]).toBe(
      primaryAndSecondaryCategory.secondaryCategory?.id
    );
  });

  it('skips secondary category without primary category', () => {
    const writer = new AppleConfigWriter();
    writer.setCategories(secondaryOnlyCategory as any);
    expect(writer.schema.categories).toHaveLength(0);
  });
});

describe('setVersion', () => {
  it('modifies the copyright', () => {
    const writer = new AppleConfigWriter();
    writer.setVersion(manualRelease);
    expect(writer.schema.copyright).toBe(manualRelease.copyright);
  });
});

describe('setVersionRelease', () => {
  it('modifies scheduled release', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionRelease(scheduledRelease);
    expect(writer.schema.release).toMatchObject({
      autoReleaseDate: scheduledRelease.earliestReleaseDate,
    });
  });

  it('modifies automatic release', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionRelease(automaticRelease);
    expect(writer.schema.release).toMatchObject({
      automaticRelease: true,
    });
  });

  it('modifies manual release', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionRelease(manualRelease);
    expect(writer.schema.release).toMatchObject({
      automaticRelease: false,
    });
  });

  it('overwrites all release fields', () => {
    const writer = new AppleConfigWriter();
    writer.setVersionRelease(scheduledRelease);
    writer.setVersionRelease(manualRelease);
    expect(writer.schema.release).not.toHaveProperty('autoReleaseDate');
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
