#!/usr/bin/env node
/**
 * Temporary postinstall patch for @expo/apple-utils v2.1.13.
 *
 * Bug: ConnectResponse.fetchNextPageAsync() passes absolute Apple API URLs
 * (e.g. https://developer.apple.com/services-account/v1/...) directly to
 * axios. When the URL is already absolute, axios ignores the configured
 * baseURL (https://developer-mdn.apple.com), so the request hits
 * developer.apple.com instead. tough-cookie then rejects the session cookies
 * because they were set for developer-mdn.apple.com.
 *
 * Fix: Strip the domain from pagination URLs in getNextUrl() so they are
 * always resolved relative to the baseURL, keeping all requests on the same
 * domain as the authenticated session.
 *
 * TypeScript source fix (to be applied upstream in @expo/apple-utils):
 *
 *   // Before
 *   getNextUrl(): string | null {
 *     return this.data?.links?.next ?? null;
 *   }
 *
 *   // After
 *   getNextUrl(): string | null {
 *     const next = this.data?.links?.next ?? null;
 *     if (!next) return null;
 *     try {
 *       const parsed = new URL(next);
 *       return parsed.pathname + parsed.search;
 *     } catch {
 *       return next;
 *     }
 *   }
 *
 * Upstream issue: https://github.com/expo/eas-cli/issues/3392
 * Remove this script once @expo/apple-utils publishes a version with the fix.
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(
  __dirname,
  '..',
  'node_modules',
  '@expo',
  'apple-utils',
  'build',
  'index.js'
);

const OLD =
  'getNextUrl(){var e,t,r;return null!==(r=null===(t=null===(e=this.data)||void 0===e?void 0:e.links)||void 0===t?void 0:t.next)&&void 0!==r?r:null}';

const NEW =
  'getNextUrl(){var e,t,r;const next=null!==(r=null===(t=null===(e=this.data)||void 0===e?void 0:e.links)||void 0===t?void 0:t.next)&&void 0!==r?r:null;if(!next)return null;try{const u=new URL(next);return u.pathname+u.search}catch(err){return next}}';

if (!fs.existsSync(TARGET)) {
  console.log('[patch-apple-utils] @expo/apple-utils not found — skipping.');
  process.exit(0);
}

const content = fs.readFileSync(TARGET, 'utf8');

if (content.includes(NEW)) {
  console.log('[patch-apple-utils] Already patched — skipping.');
  process.exit(0);
}

if (!content.includes(OLD)) {
  console.warn(
    '[patch-apple-utils] Target pattern not found. @expo/apple-utils may have changed — patch may no longer be needed or needs updating.'
  );
  process.exit(0);
}

fs.writeFileSync(TARGET, content.replace(OLD, NEW), 'utf8');
console.log(
  '[patch-apple-utils] ✔ Applied getNextUrl() pagination domain fix to @expo/apple-utils.'
);
