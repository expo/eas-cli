import { AppCategory, AppCategoryId, AppSubcategoryId, BundleIdPlatform } from '@expo/apple-utils';

import { AppleConfigWriter } from '../../writer';

/** Infered type of the AppleConfigWriter.setCategories attributes */
type CategoryInfoProps = Parameters<typeof AppleConfigWriter.prototype.setCategories>[0];

/**
 * Export a factory method instead of fixed categories.
 * In the tests, we need to create a couple of different categories,
 * adding them here as fixed objects won't be readable.
 */
export function makeCategory(id?: AppCategoryId | AppSubcategoryId): AppCategory | undefined {
  if (!id) {
    return undefined;
  }

  return new AppCategory({} as any, id, {
    platforms: [BundleIdPlatform.IOS, BundleIdPlatform.MAC_OS],
  });
}

/**
 * Export a helper method to create the AppInfo object, using only AppCategoryIds or AppSubcategoryId.
 */
export function makeCategoryInfo(
  attributes: Partial<Record<keyof CategoryInfoProps, AppCategoryId | AppSubcategoryId>>
): CategoryInfoProps {
  return {
    primaryCategory: makeCategory(attributes.primaryCategory),
    primarySubcategoryOne: makeCategory(attributes.primarySubcategoryOne),
    primarySubcategoryTwo: makeCategory(attributes.primarySubcategoryTwo),
    secondaryCategory: makeCategory(attributes.secondaryCategory),
    secondarySubcategoryOne: makeCategory(attributes.secondarySubcategoryOne),
    secondarySubcategoryTwo: makeCategory(attributes.secondarySubcategoryTwo),
  };
}
