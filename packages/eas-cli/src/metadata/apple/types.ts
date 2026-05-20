import type {
  AgeRatingDeclarationProps,
  AppClipAction,
  AppDataUsageCategoryId,
  AppDataUsageDataProtectionId,
  AppDataUsagePurposeId,
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
  /** App Clip metadata. Only applies to apps that ship an App Clip target. */
  appClip?: AppleAppClip;
  /** Privacy metadata, including App Privacy Nutrition Labels (data usage). */
  privacy?: ApplePrivacy;
}

/** Top-level privacy block. Currently only contains data usage (Privacy Nutrition Labels). */
export interface ApplePrivacy {
  /**
   * Privacy Nutrition Labels (App Privacy details). Required for new app
   * submissions since 2021. When set, the local config is treated as the
   * source of truth: existing data usage entries on App Store Connect are
   * replaced to match, then published.
   */
  dataUsage?: AppleDataUsage;
}

/** Data usage category enum (e.g. CONTACTS, PRECISE_LOCATION). */
export type AppleDataUsageCategoryId = `${AppDataUsageCategoryId}`;

/** Data usage purpose enum (e.g. ANALYTICS, APP_FUNCTIONALITY). */
export type AppleDataUsagePurposeId = `${AppDataUsagePurposeId}`;

/** Data protection / linkage enum (e.g. DATA_LINKED_TO_YOU). */
export type AppleDataUsageDataProtectionId = `${AppDataUsageDataProtectionId}`;

/**
 * Privacy Nutrition Labels — declarative declaration of data collected by the
 * app. When `dataNotCollected` is true, no data is collected and `categories`
 * must be omitted (or empty).
 */
export interface AppleDataUsage {
  /**
   * Whether the app collects no data at all. When set, `categories` must be
   * empty. Mirrors Apple's "Data Not Collected" toggle in App Store Connect.
   */
  dataNotCollected?: boolean;
  /** Per-category declarations. Order is not significant. */
  categories?: AppleDataUsageCategoryEntry[];
}

/**
 * One declaration row in the App Privacy details. Each row pairs a data
 * category with the purposes it's used for and the protection / linkage
 * applied to it.
 */
export interface AppleDataUsageCategoryEntry {
  /** Apple data category, e.g. `CONTACTS`, `PRECISE_LOCATION`. */
  category: AppleDataUsageCategoryId;
  /**
   * Purposes the category is used for, e.g. `ANALYTICS`, `APP_FUNCTIONALITY`.
   * At least one entry is required when the category is collected.
   */
  purposes?: AppleDataUsagePurposeId[];
  /**
   * Data protection / linkage classification, e.g. `DATA_LINKED_TO_YOU`,
   * `DATA_USED_TO_TRACK_YOU`. Multiple values are allowed: a single category
   * can be both linked to the user and used for tracking.
   */
  protections?: AppleDataUsageDataProtectionId[];
}

/** App Clip action enum values from App Store Connect API */
export type AppleAppClipAction = `${AppClipAction}`;

export interface AppleAppClip {
  /** The default experience for this App Clip. There is exactly one per app. */
  defaultExperience?: AppleAppClipDefaultExperience;
}

export interface AppleAppClipDefaultExperience {
  /** Action button shown in the App Clip card. Defaults to OPEN if unset. */
  action?: AppleAppClipAction;
  /** Whether to release this default experience alongside the next App Store version. */
  releaseWithAppStoreVersion?: boolean;
  /** App Store review invocation URLs (used by App Review to launch the clip). */
  reviewDetail?: AppleAppClipReviewDetail;
  /** Per-locale subtitle and header image. */
  info?: Record<AppleLocale, AppleAppClipLocalizedInfo>;
}

export interface AppleAppClipReviewDetail {
  invocationUrls: string[];
}

export interface AppleAppClipLocalizedInfo {
  /** Subtitle shown in the App Clip card. Apple limits this to 43 characters. */
  subtitle?: string;
  /** Relative path (from project root) to the App Clip header image PNG. */
  headerImage?: string;
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
