import type { AgeRatingDeclarationProps, AppCategoryId, AppSubcategoryId } from '@expo/apple-utils';

export type AppleLocale = string;

export interface AppleMetadata {
  copyright?: string;
  info?: Record<AppleLocale, AppleInfo>;
  categories?: AppCategoryId[] | AppleCategory;
  release?: AppleRelease;
  advisory?: AppleAdvisory;
  preview?: Record<string, string[]>;
  review?: AppleReview;
}

export type AppleAdvisory = Partial<AgeRatingDeclarationProps>;

export interface AppleCategory {
  category: AppCategoryId;
  subcategory?: AppSubcategoryId[];
}

export interface AppleRelease {
  isPhasedReleaseEnabled?: boolean;
  shouldResetRatings?: boolean;
  autoReleaseDate?: number | string;
  automaticRelease?: boolean;
  usesThirdPartyContent?: boolean;
  /** Alternative to setting `ITSAppUsesNonExemptEncryption` in the binary's `Info.plist`. */
  usesNonExemptEncryption?: boolean;
}

export interface AppleInfo {
  title: string;
  subtitle?: string;
  /** Does not effect ASO https://developer.apple.com/app-store/product-page/ */
  promoText?: string;
  description?: string;
  keywords?: string[];
  releaseNotes?: string;
  marketingUrl?: string;
  privacyPolicyUrl?: string;
  privacyPolicyText?: string;
  privacyChoicesUrl?: string;
  supportUrl?: string;
}

export interface AppleReview {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  demoUsername?: string;
  demoPassword?: string;
  demoRequired?: boolean;
  notes?: string;
  // attachment?: string;
}
