import type {
  AgeRatingDeclarationProps,
  PreviewType,
  ScreenshotDisplayType,
} from '@expo/apple-utils';

export type AppleLocale = string;

/** Screenshot display type enum values from App Store Connect API */
export type AppleScreenshotDisplayType = `${ScreenshotDisplayType}`;

/** Preview display type enum values from App Store Connect API */
export type ApplePreviewType = `${PreviewType}`;

/**
 * Screenshots organized by display type.
 * Key is the display type (e.g., 'APP_IPHONE_67'), value is array of file paths.
 * @example { "APP_IPHONE_67": ["./screenshots/home.png", "./screenshots/profile.png"] }
 */
export type AppleScreenshots = Partial<Record<AppleScreenshotDisplayType, string[]>>;

/**
 * Video preview configuration - either a simple path string or an object with options.
 * @example "./previews/demo.mp4"
 * @example { path: "./previews/demo.mp4", previewFrameTimeCode: "00:05:00" }
 */
export type ApplePreviewConfig =
  | string
  | {
      /** Video file path (relative to project root) */
      path: string;
      /** Optional preview frame time code (e.g., '00:05:00' for 5 seconds) */
      previewFrameTimeCode?: string;
    };

/**
 * Video previews organized by display type.
 * Key is the display type (e.g., 'IPHONE_67'), value is the preview config.
 * @example { "IPHONE_67": "./previews/demo.mp4" }
 * @example { "IPHONE_67": { path: "./previews/demo.mp4", previewFrameTimeCode: "00:05:00" } }
 */
export type ApplePreviews = Partial<Record<ApplePreviewType, ApplePreviewConfig>>;

export interface AppleMetadata {
  version?: string;
  copyright?: string;
  info?: Record<AppleLocale, AppleInfo>;
  categories?: AppleCategory;
  release?: AppleRelease;
  advisory?: AppleAdvisory;
  /** @deprecated Use screenshots/previews in AppleInfo instead */
  preview?: Record<string, string[]>;
  review?: AppleReview;
}

// The omited properties are deprecated
export type AppleAdvisory = Omit<
  Partial<AgeRatingDeclarationProps>,
  'seventeenPlus' | 'gamblingAndContests'
>;

/** Apps can define up to two categories, or categories with up to two subcategories */
export type AppleCategory = (string | string[])[];

export interface AppleRelease {
  automaticRelease?: boolean | string;
  phasedRelease?: boolean;
}

export interface AppleInfo {
  title: string;
  subtitle?: string;
  /** Does not effect ASO https://developer-mdn.apple.com/app-store/product-page/ */
  promoText?: string;
  description?: string;
  keywords?: string[];
  releaseNotes?: string;
  marketingUrl?: string;
  privacyPolicyUrl?: string;
  privacyPolicyText?: string;
  privacyChoicesUrl?: string;
  supportUrl?: string;
  /** Screenshots for this locale, organized by display type */
  screenshots?: AppleScreenshots;
  /** Video previews for this locale, organized by display type */
  previews?: ApplePreviews;
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
