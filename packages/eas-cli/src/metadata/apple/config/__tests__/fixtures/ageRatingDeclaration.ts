import {
  AgeRatingDeclaration,
  KidsAgeBand,
  KoreaRatingOverride,
  Rating,
  RatingOverride,
} from '@expo/apple-utils';

import { AttributesOf } from '../../../../utils/asc';

// Note, both `seventeenPlus` and `gamlingAndContests` are deprecated
type AgeRatingDeclarationProps = Omit<
  AttributesOf<AgeRatingDeclaration>,
  'seventeenPlus' | 'gamblingAndContests'
>;

// These attributes is what we get from the API when no questions are answered
export const emptyAdvisory: AgeRatingDeclarationProps = {
  alcoholTobaccoOrDrugUseOrReferences: null,
  contests: null,
  gamblingSimulated: null,
  horrorOrFearThemes: null,
  matureOrSuggestiveThemes: null,
  medicalOrTreatmentInformation: null,
  profanityOrCrudeHumor: null,
  sexualContentGraphicAndNudity: null,
  sexualContentOrNudity: null,
  violenceCartoonOrFantasy: null,
  violenceRealistic: null,
  violenceRealisticProlongedGraphicOrSadistic: null,
  gambling: false,
  unrestrictedWebAccess: false,
  kidsAgeBand: null,
  ageRatingOverride: null,
  koreaAgeRatingOverride: null,
  lootBox: null,
};

export const leastRestrictiveAdvisory: AgeRatingDeclarationProps = {
  alcoholTobaccoOrDrugUseOrReferences: Rating.NONE,
  contests: Rating.NONE,
  gamblingSimulated: Rating.NONE,
  horrorOrFearThemes: Rating.NONE,
  matureOrSuggestiveThemes: Rating.NONE,
  medicalOrTreatmentInformation: Rating.NONE,
  profanityOrCrudeHumor: Rating.NONE,
  sexualContentGraphicAndNudity: Rating.NONE,
  sexualContentOrNudity: Rating.NONE,
  violenceCartoonOrFantasy: Rating.NONE,
  violenceRealistic: Rating.NONE,
  violenceRealisticProlongedGraphicOrSadistic: Rating.NONE,
  gambling: false,
  unrestrictedWebAccess: false,
  kidsAgeBand: null,
  ageRatingOverride: RatingOverride.NONE,
  koreaAgeRatingOverride: KoreaRatingOverride.NONE,
  lootBox: false,
};

export const mostRestrictiveAdvisory: AgeRatingDeclarationProps = {
  alcoholTobaccoOrDrugUseOrReferences: Rating.FREQUENT_OR_INTENSE,
  contests: Rating.FREQUENT_OR_INTENSE,
  gamblingSimulated: Rating.FREQUENT_OR_INTENSE,
  horrorOrFearThemes: Rating.FREQUENT_OR_INTENSE,
  matureOrSuggestiveThemes: Rating.FREQUENT_OR_INTENSE,
  medicalOrTreatmentInformation: Rating.FREQUENT_OR_INTENSE,
  profanityOrCrudeHumor: Rating.FREQUENT_OR_INTENSE,
  sexualContentGraphicAndNudity: Rating.FREQUENT_OR_INTENSE,
  sexualContentOrNudity: Rating.FREQUENT_OR_INTENSE,
  violenceCartoonOrFantasy: Rating.FREQUENT_OR_INTENSE,
  violenceRealistic: Rating.FREQUENT_OR_INTENSE,
  violenceRealisticProlongedGraphicOrSadistic: Rating.FREQUENT_OR_INTENSE,
  gambling: true,
  unrestrictedWebAccess: true,
  kidsAgeBand: null,
  ageRatingOverride: RatingOverride.SEVENTEEN_PLUS,
  koreaAgeRatingOverride: KoreaRatingOverride.NINETEEN_PLUS,
  lootBox: true,
};

export const kidsSixToEightAdvisory: AgeRatingDeclarationProps = {
  alcoholTobaccoOrDrugUseOrReferences: Rating.NONE,
  contests: Rating.NONE,
  gamblingSimulated: Rating.NONE,
  horrorOrFearThemes: Rating.NONE,
  matureOrSuggestiveThemes: Rating.NONE,
  medicalOrTreatmentInformation: Rating.NONE,
  profanityOrCrudeHumor: Rating.NONE,
  sexualContentGraphicAndNudity: Rating.NONE,
  sexualContentOrNudity: Rating.NONE,
  violenceCartoonOrFantasy: Rating.NONE,
  violenceRealistic: Rating.NONE,
  violenceRealisticProlongedGraphicOrSadistic: Rating.NONE,
  gambling: false,
  unrestrictedWebAccess: false,
  kidsAgeBand: KidsAgeBand.SIX_TO_EIGHT,
  ageRatingOverride: RatingOverride.NONE,
  koreaAgeRatingOverride: KoreaRatingOverride.NONE,
  lootBox: false,
};
