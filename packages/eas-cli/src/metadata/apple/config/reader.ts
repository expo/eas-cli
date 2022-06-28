import {
  AgeRatingDeclaration,
  AppInfoLocalization,
  AppStoreReviewDetail,
  AppStoreVersion,
  AppStoreVersionLocalization,
  CategoryIds,
  Rating,
  ReleaseType,
} from '@expo/apple-utils';

import uniq from '../../../utils/expodash/uniq';
import { AttributesOf } from '../../utils/asc';
import { removeDatePrecision } from '../../utils/date';
import { AppleMetadata } from '../types';

type PartialExcept<T, K extends keyof T> = Pick<T, K> & Partial<Omit<T, K>>;

// TODO: find out if we can move this to default JSON schema normalization
export const DEFAULT_WHATSNEW = 'Bug fixes and improved stability';

/**
 * Deserializes the metadata config schema into attributes for different models.
 * This uses version 0 of the config schema.
 */
export class AppleConfigReader {
  public constructor(public readonly schema: AppleMetadata) {}

  public getAgeRating(): Partial<AttributesOf<AgeRatingDeclaration>> | null {
    const attributes = this.schema.advisory;
    if (!attributes) {
      return null;
    }

    return {
      alcoholTobaccoOrDrugUseOrReferences:
        attributes.alcoholTobaccoOrDrugUseOrReferences ?? Rating.NONE,
      contests: attributes.contests ?? Rating.NONE,
      gamblingSimulated: attributes.gamblingSimulated ?? Rating.NONE,
      horrorOrFearThemes: attributes.horrorOrFearThemes ?? Rating.NONE,
      matureOrSuggestiveThemes: attributes.matureOrSuggestiveThemes ?? Rating.NONE,
      medicalOrTreatmentInformation: attributes.medicalOrTreatmentInformation ?? Rating.NONE,
      profanityOrCrudeHumor: attributes.profanityOrCrudeHumor ?? Rating.NONE,
      sexualContentGraphicAndNudity: attributes.sexualContentGraphicAndNudity ?? Rating.NONE,
      sexualContentOrNudity: attributes.sexualContentOrNudity ?? Rating.NONE,
      violenceCartoonOrFantasy: attributes.violenceCartoonOrFantasy ?? Rating.NONE,
      violenceRealistic: attributes.violenceRealistic ?? Rating.NONE,
      violenceRealisticProlongedGraphicOrSadistic:
        attributes.violenceRealisticProlongedGraphicOrSadistic ?? Rating.NONE,
      gambling: attributes.gambling ?? false,
      unrestrictedWebAccess: attributes.unrestrictedWebAccess ?? false,
      kidsAgeBand: attributes.kidsAgeBand ?? null,
      seventeenPlus: attributes.seventeenPlus ?? false,
    };
  }

  public getLocales(): string[] {
    // TODO: filter "default" locales, add option to add non-localized info to the config
    return uniq(Object.keys(this.schema.info || {}));
  }

  public getInfoLocale(
    locale: string
  ): PartialExcept<AttributesOf<AppInfoLocalization>, 'locale' | 'name'> | null {
    const info = this.schema.info?.[locale];
    if (!info) {
      return null;
    }

    return {
      locale,
      name: info.title,
      subtitle: info.subtitle,
      privacyChoicesUrl: info.privacyChoicesUrl,
      privacyPolicyText: info.privacyPolicyText,
      privacyPolicyUrl: info.privacyPolicyUrl,
    };
  }

  public getCategories(): CategoryIds | null {
    if (Array.isArray(this.schema.categories) && this.schema.categories.length > 0) {
      return {
        primaryCategory: this.schema.categories[0],
        secondaryCategory: this.schema.categories[1],
      };
    }

    return null;
  }

  /** Get the `AppStoreVersion` object. */
  public getVersion(): Partial<
    Omit<AttributesOf<AppStoreVersion>, 'releaseType' | 'earliestReleaseDate'>
  > | null {
    return this.schema.copyright ? { copyright: this.schema.copyright } : null;
  }

  public getVersionRelease(): Partial<
    Pick<AttributesOf<AppStoreVersion>, 'releaseType' | 'earliestReleaseDate'>
  > | null {
    const { release } = this.schema;

    if (release?.autoReleaseDate) {
      return {
        releaseType: ReleaseType.SCHEDULED,
        // Convert time format to 2020-06-17T12:00:00-07:00
        earliestReleaseDate: removeDatePrecision(release.autoReleaseDate)?.toISOString() ?? null,
      };
    }

    if (release?.automaticRelease === true) {
      return {
        releaseType: ReleaseType.AFTER_APPROVAL,
        earliestReleaseDate: null,
      };
    }

    if (release?.automaticRelease === false) {
      return {
        releaseType: ReleaseType.MANUAL,
        earliestReleaseDate: null,
      };
    }

    return null;
  }

  public getVersionLocale(
    locale: string,
    context: { versionIsFirst: boolean }
  ): Partial<AttributesOf<AppStoreVersionLocalization>> | null {
    const info = this.schema.info?.[locale];
    if (!info) {
      return null;
    }

    return {
      locale,
      description: info.description,
      keywords: info.keywords?.join(', '),
      // TODO: maybe move this to task logic, it's more an exception than data handling
      whatsNew: context.versionIsFirst ? undefined : info.releaseNotes || DEFAULT_WHATSNEW,
      marketingUrl: info.marketingUrl,
      promotionalText: info.promoText,
      supportUrl: info.supportUrl,
    };
  }

  public getReviewDetails(): Partial<AttributesOf<AppStoreReviewDetail>> | null {
    const review = this.schema.review;
    if (!review) {
      return null;
    }

    return {
      contactFirstName: review.firstName,
      contactLastName: review.lastName,
      contactEmail: review.email,
      contactPhone: review.phone,
      demoAccountName: review.demoUsername,
      demoAccountPassword: review.demoPassword,
      demoAccountRequired: review.demoRequired,
      notes: review.notes,
      // TODO: add attachment
    };
  }
}
