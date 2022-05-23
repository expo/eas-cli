import {
  AgeRatingDeclaration,
  AppInfoLocalization,
  AppStoreVersion,
  AppStoreVersionLocalization,
  CategoryIds,
  ReleaseType,
} from '@expo/apple-utils';

import { AppleMetadata } from '../../schema';
import { AttributesOf } from '../../utils/asc';

/**
 * Serializes the Apple ASC entities into the metadata configuration schema.
 * This uses version 0 of the config schema.
 */
export class AppleConfigWriter {
  constructor(public readonly schema: Partial<AppleMetadata> = {}) {}

  /** Get the schema result to write it to the config file */
  toSchema(): { apple: Partial<AppleMetadata> } {
    return { apple: this.schema };
  }

  setAgeRating(attributes: AttributesOf<AgeRatingDeclaration>): void {
    this.schema.advisory = attributes;
  }

  setInfoLocale(attributes: AttributesOf<AppInfoLocalization>): void {
    this.schema.info = this.schema.info ?? {};
    const existing = this.schema.info[attributes.locale] ?? {};

    this.schema.info[attributes.locale] = {
      ...existing,
      title: attributes.name ?? 'no name provided',
      subtitle: optional(attributes.subtitle),
      privacyPolicyUrl: optional(attributes.privacyPolicyUrl),
      privacyPolicyText: optional(attributes.privacyPolicyText),
      privacyChoicesUrl: optional(attributes.privacyChoicesUrl),
    };
  }

  setCategories({ primaryCategory, secondaryCategory }: CategoryIds): void {
    this.schema.categories = [];

    if (primaryCategory) {
      this.schema.categories.push(primaryCategory);
      if (secondaryCategory) {
        this.schema.categories.push(secondaryCategory);
      }
    }
  }

  setVersion(
    attributes: Omit<AttributesOf<AppStoreVersion>, 'releaseType' | 'earliestReleaseDate'>
  ): void {
    this.schema.copyright = optional(attributes.copyright);
  }

  setVersionRelease(
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
      this.schema.release = {
        automaticRelease: false,
      };
    }
  }

  setVersionLocale(attributes: AttributesOf<AppStoreVersionLocalization>): void {
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

/** Helper function to convert `T | null` to `T | undefined` */
function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}
