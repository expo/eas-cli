import { AppCategoryId, AppSubcategoryId } from '@expo/apple-utils';

import { AppleConfigReader } from '../reader';
import { leastRestrictiveAdvisory, mostRestrictiveAdvisory } from './fixtures/ageRatingDeclaration';

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
    const reader = new AppleConfigReader({ categories: [[AppCategoryId.GAMES]] });
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
