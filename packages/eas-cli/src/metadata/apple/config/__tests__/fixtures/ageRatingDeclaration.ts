import AppleUtils from '@expo/apple-utils';

import { AttributesOf } from '../../../../utils/asc.js';

const { KidsAge, Rating } = AppleUtils;

// @ts-expect-error: Deprecated property `gamblingAndContests` needs to be deleted from the types
// These attributes is what we get from the API when no questions are answered
export const emptyAdvisory: AttributesOf<AppleUtils.AgeRatingDeclaration> = {
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
  seventeenPlus: false,
};

// @ts-expect-error: Deprecated property `gamblingAndContests` needs to be deleted from the types
export const leastRestrictiveAdvisory: AttributesOf<AppleUtils.AgeRatingDeclaration> = {
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
  seventeenPlus: false,
};

// @ts-expect-error: Deprecated property `gamblingAndContests` needs to be deleted from the types
export const mostRestrictiveAdvisory: AttributesOf<AppleUtils.AgeRatingDeclaration> = {
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
  seventeenPlus: true,
};

// @ts-expect-error: Deprecated property `gamblingAndContests` needs to be deleted from the types
export const kidsSixToEightAdvisory: AttributesOf<AppleUtils.AgeRatingDeclaration> = {
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
  kidsAgeBand: KidsAge.SIX_TO_EIGHT,
  seventeenPlus: false,
};
