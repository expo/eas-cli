import type {
  AgeRatingDeclarationProps,
  AppClipAction,
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
  /**
   * In-App Purchase listing. Currently limited to a declarative round-trip
   * of `productId`, `referenceName`, and `type`. Localizations, pricing,
   * and review screenshots are intentionally out of scope for now.
   *
   * Note: auto-renewable subscriptions are a separate Apple resource
   * (`subscriptionGroups` / `subscriptions`) and are intentionally out of
   * scope for this task. They may appear here as legacy v1 entries on pull
   * but cannot be created/managed via IAP APIs.
   *
   * TODO: Once apple-utils is bumped with InAppPurchaseLocalization
   * (expo/third-party#148), add an optional `localizations` array per IAP
   * entry for localized name/description round-trip.
   */
  inAppPurchases?: AppleInAppPurchase[];
}

/**
 * In-App Purchase type values from App Store Connect API.
 *
 * The v2 `inAppPurchasesV2` resource only supports CONSUMABLE, NON_CONSUMABLE,
 * and NON_RENEWING_SUBSCRIPTION. Auto-renewable subscriptions are a completely
 * separate Apple resource (`subscriptionGroups` / `subscriptions`) and are NOT
 * part of the IAP v2 API. See expo/third-party#148 for details.
 *
 * The legacy v1 types are preserved so that `metadata:pull` can still surface
 * existing auto-renewable and free subscription IAPs that were created before
 * the v2 split.
 */
export type AppleInAppPurchaseType =
  /** v2 IAP types (supported for CRUD once apple-utils is bumped) */
  | 'CONSUMABLE'
  | 'NON_CONSUMABLE'
  | 'NON_RENEWING_SUBSCRIPTION'
  /** @deprecated v1 legacy — auto-renewable subscriptions live on `subscriptionGroups`/`subscriptions` in v2 */
  | 'AUTO_RENEWABLE_SUBSCRIPTION'
  /** @deprecated v1 legacy — same as AUTO_RENEWABLE_SUBSCRIPTION, apple-utils v1 spelling */
  | 'AUTOMATICALLY_RENEWABLE_SUBSCRIPTION'
  /** @deprecated v1 legacy */
  | 'FREE_SUBSCRIPTION';

export interface AppleInAppPurchase {
  /** Product identifier (primary key, must be unique within the app). */
  productId: string;
  /** Internal reference name shown in App Store Connect. */
  referenceName: string;
  /** IAP type. */
  type: AppleInAppPurchaseType | string;
  /** Read-only review/state from App Store Connect. Only populated on pull. */
  state?: string;
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
