/**
 * Directories, relative to the project directory, that `eas metadata:pull`
 * downloads store media to and that `eas metadata:push` uploads it from.
 *
 * They are only read by the CLI itself, so the media is left out of the copy of
 * the project that is uploaded for a build.
 */
export const STORE_SCREENSHOT_DIRECTORY = 'store/apple/screenshot';
export const STORE_PREVIEW_DIRECTORY = 'store/apple/preview';
export const STORE_APP_CLIP_DIRECTORY = 'store/apple/app-clip';

export const STORE_MEDIA_DIRECTORIES = [
  STORE_SCREENSHOT_DIRECTORY,
  STORE_PREVIEW_DIRECTORY,
  STORE_APP_CLIP_DIRECTORY,
];
