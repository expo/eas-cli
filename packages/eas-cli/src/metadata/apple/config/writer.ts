import {
  AgeRatingDeclaration,
  AppInfo,
  AppInfoLocalization,
  AppStoreVersion,
  AppStoreVersionLocalization,
  Rating,
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

  public setAgeRating(attributes: AttributesOf<AgeRatingDeclaration>): void {
    this.schema.advisory = {
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

  public setCategories({ primaryCategory, secondaryCategory }: AttributesOf<AppInfo>): void {
    this.schema.categories = [];

    // TODO: see why these types are conflicting
    if (primaryCategory) {
      this.schema.categories.push(primaryCategory.id as any);
      if (secondaryCategory) {
        this.schema.categories.push(secondaryCategory.id as any);
      }
    }
  }

  public setVersion(
    attributes: Omit<AttributesOf<AppStoreVersion>, 'releaseType' | 'earliestReleaseDate'>
  ): void {
    this.schema.copyright = optional(attributes.copyright);
  }

  public setVersionRelease(
    attributes: Pick<AttributesOf<AppStoreVersion>, 'releaseType' | 'earliestReleaseDate'>
  ): void {
    if (attributes.releaseType === ReleaseType.SCHEDULED) {
      this.schema.release = {
        autoReleaseDate: optional(attributes.earliestReleaseDate),
      };
    }

    if (attributes.releaseType === ReleaseType.AFTER_APPROVAL) {
      this.schema.release = {
        automaticRelease: true,
      };
    }

    if (attributes.releaseType === ReleaseType.MANUAL) {
      // ReleaseType.MANUAL is the default behavior, so we don't need to configure it.
      // Setting `"automaticRelease": false` is a bit confusing for people who don't know what automaticRelease does.
      this.schema.release = undefined;
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
}

/** Helper function to convert `T | null` to `T | undefined`, required for the entity properties */
function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}
