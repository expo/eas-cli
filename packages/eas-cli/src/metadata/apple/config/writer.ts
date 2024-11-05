import {
  AgeRatingDeclaration,
  AppInfo,
  AppInfoLocalization,
  AppStoreReviewDetail,
  AppStoreVersion,
  AppStoreVersionLocalization,
  AppStoreVersionPhasedRelease,
  KoreaRatingOverride,
  Rating,
  RatingOverride,
  ReleaseType,
} from '@expo/apple-utils';

import { AttributesOf } from '../../utils/asc';
import { AppleMetadata } from '../types';

/**
 * Serializes the Apple ASC entities into the metadata configuration schema.
 * This uses version 0 of the config schema.
 */
export class AppleConfigWriter {
  constructor(public readonly schema: Partial<AppleMetadata> = {}) {}

  /** Get the schema result to write it to the config file */
  public toSchema(): { configVersion: number; apple: Partial<AppleMetadata> } {
    return {
      configVersion: 0,
      apple: this.schema,
    };
  }

  // Note, both `seventeenPlus` and `gamlingAndContests` are deprecated
  public setAgeRating(
    attributes: Omit<AttributesOf<AgeRatingDeclaration>, 'seventeenPlus' | 'gamblingAndContests'>
  ): void {
    this.schema.advisory = {
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

  public setInfoLocale(attributes: AttributesOf<AppInfoLocalization>): void {
    this.schema.info = this.schema.info ?? {};
    const existing = this.schema.info[attributes.locale] ?? {};

    this.schema.info[attributes.locale] = {
      ...existing,
      title: attributes.name ?? '',
      subtitle: optional(attributes.subtitle),
      privacyPolicyUrl: optional(attributes.privacyPolicyUrl),
      privacyPolicyText: optional(attributes.privacyPolicyText),
      privacyChoicesUrl: optional(attributes.privacyChoicesUrl),
    };
  }

  public setCategories(
    attributes: Pick<
      AttributesOf<AppInfo>,
      | 'primaryCategory'
      | 'primarySubcategoryOne'
      | 'primarySubcategoryTwo'
      | 'secondaryCategory'
      | 'secondarySubcategoryOne'
      | 'secondarySubcategoryTwo'
    >
  ): void {
    this.schema.categories = undefined;
    if (!attributes.primaryCategory && !attributes.secondaryCategory) {
      return;
    }

    this.schema.categories = [];

    if (attributes.primaryCategory && attributes.primarySubcategoryOne) {
      this.schema.categories[0] = [
        attributes.primaryCategory.id,
        attributes.primarySubcategoryOne?.id,
        attributes.primarySubcategoryTwo?.id,
      ].filter(Boolean) as string[];
    } else {
      // If only the secondaryCategory was provided,
      // autofill with an empty string and cause a store config error.
      this.schema.categories[0] = attributes.primaryCategory?.id ?? '';
    }

    if (attributes.secondaryCategory && attributes.secondarySubcategoryOne) {
      this.schema.categories[1] = [
        attributes.secondaryCategory.id,
        attributes.secondarySubcategoryOne?.id,
        attributes.secondarySubcategoryTwo?.id,
      ].filter(Boolean) as string[];
    } else if (attributes.secondaryCategory) {
      this.schema.categories[1] = attributes.secondaryCategory.id;
    }
  }

  public setVersion(
    attributes: Omit<AttributesOf<AppStoreVersion>, 'releaseType' | 'earliestReleaseDate'>
  ): void {
    this.schema.version = optional(attributes.versionString);
    this.schema.copyright = optional(attributes.copyright);
  }

  public setVersionReleaseType(
    attributes: Pick<AttributesOf<AppStoreVersion>, 'releaseType' | 'earliestReleaseDate'>
  ): void {
    if (attributes.releaseType === ReleaseType.SCHEDULED && attributes.earliestReleaseDate) {
      this.schema.release = {
        ...this.schema.release,
        automaticRelease: attributes.earliestReleaseDate,
      };
    }

    if (attributes.releaseType === ReleaseType.AFTER_APPROVAL) {
      this.schema.release = {
        ...this.schema.release,
        automaticRelease: true,
      };
    }

    if (attributes.releaseType === ReleaseType.MANUAL) {
      this.schema.release = {
        ...this.schema.release,
        automaticRelease: false,
      };
    }
  }

  public setVersionReleasePhased(attributes?: AttributesOf<AppStoreVersionPhasedRelease>): void {
    if (!attributes) {
      delete this.schema.release?.phasedRelease;
    } else {
      this.schema.release = {
        ...this.schema.release,
        phasedRelease: true,
      };
    }
  }

  public setVersionLocale(attributes: AttributesOf<AppStoreVersionLocalization>): void {
    this.schema.info = this.schema.info ?? {};
    const existing = this.schema.info[attributes.locale] ?? {};

    this.schema.info[attributes.locale] = {
      ...existing,
      description: optional(attributes.description),
      keywords: optional(attributes.keywords)
        ?.split(',')
        .map(keyword => keyword.trim()),
      releaseNotes: optional(attributes.whatsNew),
      marketingUrl: optional(attributes.marketingUrl),
      promoText: optional(attributes.promotionalText),
      supportUrl: optional(attributes.supportUrl),
    };
  }

  public setReviewDetails(attributes: AttributesOf<AppStoreReviewDetail>): void {
    this.schema.review = {
      firstName: attributes.contactFirstName ?? '',
      lastName: attributes.contactLastName ?? '',
      email: attributes.contactEmail ?? '',
      phone: attributes.contactPhone ?? '',
      demoUsername: optional(attributes.demoAccountName),
      demoPassword: optional(attributes.demoAccountPassword),
      demoRequired: optional(attributes.demoAccountRequired),
      notes: optional(attributes.notes),
      // TODO: add attachment
    };
  }
}

/** Helper function to convert `T | null` to `T | undefined`, required for the entity properties */
function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}
