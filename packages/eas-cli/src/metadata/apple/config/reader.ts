import {
  AgeRatingDeclaration,
  AppInfoLocalization,
  AppStoreReviewDetail,
  AppStoreVersion,
  AppStoreVersionLocalization,
  AppStoreVersionPhasedRelease,
  CategoryIds,
  KoreaRatingOverride,
  PhasedReleaseState,
  Rating,
  RatingOverride,
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
      ageRatingOverride: attributes.ageRatingOverride ?? RatingOverride.NONE,
      alcoholTobaccoOrDrugUseOrReferences:
        attributes.alcoholTobaccoOrDrugUseOrReferences ?? Rating.NONE,
      contests: attributes.contests ?? Rating.NONE,
      gambling: attributes.gambling ?? false,
      gamblingSimulated: attributes.gamblingSimulated ?? Rating.NONE,
      horrorOrFearThemes: attributes.horrorOrFearThemes ?? Rating.NONE,
      kidsAgeBand: attributes.kidsAgeBand ?? null,
      koreaAgeRatingOverride: attributes.koreaAgeRatingOverride ?? KoreaRatingOverride.NONE,
      lootBox: attributes.lootBox ?? false,
      matureOrSuggestiveThemes: attributes.matureOrSuggestiveThemes ?? Rating.NONE,
      medicalOrTreatmentInformation: attributes.medicalOrTreatmentInformation ?? Rating.NONE,
      profanityOrCrudeHumor: attributes.profanityOrCrudeHumor ?? Rating.NONE,
      sexualContentGraphicAndNudity: attributes.sexualContentGraphicAndNudity ?? Rating.NONE,
      sexualContentOrNudity: attributes.sexualContentOrNudity ?? Rating.NONE,
      unrestrictedWebAccess: attributes.unrestrictedWebAccess ?? false,
      violenceCartoonOrFantasy: attributes.violenceCartoonOrFantasy ?? Rating.NONE,
      violenceRealistic: attributes.violenceRealistic ?? Rating.NONE,
      violenceRealisticProlongedGraphicOrSadistic:
        attributes.violenceRealisticProlongedGraphicOrSadistic ?? Rating.NONE,
    };
  }

  public getLocales(): string[] {
    // TODO: filter "default" locales, add option to add non-localized info to the config
    return uniq(Object.keys(this.schema.info ?? {}));
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
    const { categories } = this.schema;
    if (!categories || categories.length <= 0) {
      return null;
    }

    // We validate the categories based on enums, but they will still be strings here.
    const categoryIds: Partial<Record<keyof CategoryIds, string>> = {};

    if (Array.isArray(categories[0])) {
      categoryIds.primaryCategory = categories[0][0];
      categoryIds.primarySubcategoryOne = categories[0][1];
      categoryIds.primarySubcategoryTwo = categories[0][2];
    } else {
      categoryIds.primaryCategory = categories[0];
    }

    if (Array.isArray(categories[1])) {
      categoryIds.secondaryCategory = categories[1][0];
      categoryIds.secondarySubcategoryOne = categories[1][1];
      categoryIds.secondarySubcategoryTwo = categories[1][2];
    } else {
      categoryIds.secondaryCategory = categories[1];
    }

    // Because we handle categories as normal strings,
    // the type doesn't match with the actual CategoryIds types.
    return categoryIds as CategoryIds;
  }

  /** Get the `AppStoreVersion` object. */
  public getVersion(): Partial<
    Omit<AttributesOf<AppStoreVersion>, 'releaseType' | 'earliestReleaseDate'>
  > | null {
    const attributes: Pick<AttributesOf<AppStoreVersion>, 'versionString' | 'copyright'> = {
      versionString: this.schema.version ?? '',
      copyright: this.schema.copyright ?? null,
    };

    const hasValues = Object.values(attributes).some(Boolean);
    return hasValues ? attributes : null;
  }

  public getVersionReleaseType(): Partial<
    Pick<AttributesOf<AppStoreVersion>, 'releaseType' | 'earliestReleaseDate'>
  > | null {
    const { release } = this.schema;

    if (typeof release?.automaticRelease === 'string') {
      return {
        releaseType: ReleaseType.SCHEDULED,
        // Convert time format to 2020-06-17T12:00:00-07:00, if that fails, try the date anyways.
        earliestReleaseDate:
          removeDatePrecision(release.automaticRelease)?.toISOString() ?? release.automaticRelease,
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

  public getVersionReleasePhased(): Pick<
    AttributesOf<AppStoreVersionPhasedRelease>,
    'phasedReleaseState'
  > | null {
    if (this.schema.release?.phasedRelease === true) {
      return {
        phasedReleaseState: PhasedReleaseState.ACTIVE,
      };
    }

    // When phased release is turned off, we need to delete the phased release request.
    // There is no concept (yet) of pausing the phased release through EAS metadata.
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
      keywords: info.keywords?.join(','),
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
