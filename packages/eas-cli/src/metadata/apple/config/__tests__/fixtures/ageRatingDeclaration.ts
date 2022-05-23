import { AgeRatingDeclaration, KidsAge } from '@expo/apple-utils';

import { AttributesOf } from '../../../../utils/asc';

export const kidsSixToEightAdvisory: AttributesOf<AgeRatingDeclaration> = {
  alcoholTobaccoOrDrugUseOrReferences: null,
  gamblingSimulated: null,
  gambling: null,
  contests: null,
  medicalOrTreatmentInformation: null,
  profanityOrCrudeHumor: null,
  sexualContentGraphicAndNudity: null,
  sexualContentOrNudity: null,
  horrorOrFearThemes: null,
  matureOrSuggestiveThemes: null,
  violenceCartoonOrFantasy: null,
  violenceRealisticProlongedGraphicOrSadistic: null,
  violenceRealistic: null,
  unrestrictedWebAccess: false,
  seventeenPlus: false,
  kidsAgeBand: KidsAge.SIX_TO_EIGHT,
  gamblingAndContests: false,
};
