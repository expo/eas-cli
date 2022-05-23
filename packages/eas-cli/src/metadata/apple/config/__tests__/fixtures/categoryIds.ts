import { AppCategoryId, CategoryIds } from '@expo/apple-utils';

export const primaryOnlyCategory: CategoryIds = {
  primaryCategory: AppCategoryId.GAMES,
};

export const primaryAndSecondaryCategory: CategoryIds = {
  primaryCategory: AppCategoryId.GAMES,
  secondaryCategory: AppCategoryId.EDUCATION,
};

export const secondaryOnlyCategory: CategoryIds = {
  secondaryCategory: AppCategoryId.GAMES,
};
