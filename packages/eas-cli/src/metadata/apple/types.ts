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
  /** Pricing configuration for the app (price tier, scheduled changes). */
  pricing?: ApplePricing;
  /** Territory availability configuration for the app. */
  availability?: AppleAvailability;
}

/**
 * Pricing configuration for an app.
 *
 * NOTE: Apple migrated to "base territory" pricing in 2023, replacing the
 * legacy global price tier model. The App Store Connect API still exposes a
 * `priceTier` concept on the legacy `appPrices`/`appPriceTiers` resources,
 * which is what `@expo/apple-utils` currently exposes via
 * `App.updateAsync({ appPriceTier })`. Newer apps may need to use
 * `appPriceSchedules` + `appPricePoints` (which require selecting a base
 * territory and a price point id), but those endpoints are not yet wrapped by
 * `@expo/apple-utils`. We use the legacy field for now and document this in
 * the PR. The schema is intentionally forward-compatible.
 */
export interface ApplePricing {
  /**
   * App Store price tier (e.g. `'0'` for free, `'1'` for tier 1). When
   * unset on a brand new app, the App Store defaults to free (tier 0).
   */
  tier?: string;
  /**
   * Future scheduled price changes. Each entry switches the app to the
   * given tier on `startDate`. The first entry that matches "now" or earlier
   * is treated as the current price. This block is currently parsed but not
   * pushed (the legacy `App.updateAsync` endpoint exposed by
   * `@expo/apple-utils` only sets the active tier).
   */
  schedule?: ApplePriceScheduleEntry[];
}

export interface ApplePriceScheduleEntry {
  /** ISO-8601 date the new price tier takes effect. */
  startDate: string;
  /** App Store price tier id (e.g. `'0'` for free). */
  tier: string;
}

/**
 * Territory availability configuration. Use ISO-3166 alpha-3 codes (e.g.
 * `"USA"`, `"GBR"`, `"JPN"`) — these match the App Store Connect Territory
 * resource ids.
 */
export interface AppleAvailability {
  /**
   * The territories the app is available in. Use the literal string `'all'`
   * to make the app available worldwide (every territory currently supported
   * by App Store Connect). Omitting this field leaves availability untouched.
   */
  territories?: AppleTerritoryCode[] | 'all';
}

/** ISO-3166 alpha-3 territory code (e.g. `"USA"`, `"GBR"`). */
export type AppleTerritoryCode = string;

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
