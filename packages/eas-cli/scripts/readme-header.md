<!-- Title -->

<p align="center">
  <a href="https://expo.dev/eas">
    <img alt="EAS" height="96" src="../../.github/resources/eas.svg">
  </a>
</p>

<h1 align="center">EAS CLI</h1>

<p align="center">Ship Expo and React Native apps from your terminal — build, submit, update, deploy, and automate with EAS.</p>

<p align="center">
  <a aria-label="eas documentation" href="https://docs.expo.dev/eas/">📚 Documentation</a>
  &ensp;•&ensp;
  <a aria-label="eas cli reference" href="https://docs.expo.dev/eas/cli/">📖 CLI Reference</a>
  &ensp;•&ensp;
  <a aria-label="eas" href="https://expo.dev/eas">🚀 EAS</a>
  &ensp;•&ensp;
  <a aria-label="expo blog" href="https://expo.dev/blog">📝 Blog</a>
  &ensp;•&ensp;
  <a aria-label="expo changelog" href="https://expo.dev/changelog">📰 Changelog</a>
  &ensp;•&ensp;
  <a aria-label="contribute to eas cli" href="https://github.com/expo/eas-cli/blob/main/CONTRIBUTING.md">👏 Contribute</a>
</p>

<p align="center">
  <a aria-label="npm version" href="https://www.npmjs.com/package/eas-cli" target="_blank">
    <img alt="npm version" src="https://img.shields.io/npm/v/eas-cli.svg?style=for-the-badge&label=npm&labelColor=000000&color=4630EB" />
  </a>
  <a aria-label="npm downloads" href="https://www.npmtrends.com/eas-cli" target="_blank">
    <img alt="downloads" src="https://img.shields.io/npm/dm/eas-cli.svg?style=for-the-badge&labelColor=000000&color=33CC12&label=downloads" />
  </a>
  <a aria-label="License: MIT" href="https://github.com/expo/eas-cli/blob/main/LICENSE" target="_blank">
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-success.svg?style=for-the-badge&labelColor=000000&color=33CC12" />
  </a>
  <a aria-label="Join the Expo Discord" href="https://chat.expo.dev" target="_blank">
    <img alt="Discord" src="https://img.shields.io/discord/695411232856997968.svg?style=for-the-badge&color=5865F2&logo=discord&logoColor=FFFFFF" />
  </a>
</p>

<p align="center">
  <a aria-label="Follow Expo on X" href="https://x.com/intent/follow?screen_name=expo" target="_blank">
    <img alt="Expo on X" src="https://img.shields.io/badge/X-000000?style=for-the-badge&logo=x&logoColor=white" />
  </a>&nbsp;
  <a aria-label="Follow Expo on GitHub" href="https://github.com/expo" target="_blank">
    <img alt="Expo on GitHub" src="https://img.shields.io/badge/GitHub-222222?style=for-the-badge&logo=github&logoColor=white" />
  </a>&nbsp;
  <a aria-label="Follow Expo on Reddit" href="https://www.reddit.com/r/expo/" target="_blank">
    <img alt="Expo on Reddit" src="https://img.shields.io/badge/Reddit-FF4500?style=for-the-badge&logo=reddit&logoColor=white" />
  </a>&nbsp;
  <a aria-label="Follow Expo on Bluesky" href="https://bsky.app/profile/expo.dev" target="_blank">
    <img alt="Expo on Bluesky" src="https://img.shields.io/badge/Bluesky-1DA1F2?style=for-the-badge&logo=bluesky&logoColor=white" />
  </a>&nbsp;
  <a aria-label="Follow Expo on LinkedIn" href="https://www.linkedin.com/company/expo-dev" target="_blank">
    <img alt="Expo on LinkedIn" src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=LinkedIn&logoColor=white" />
  </a>&nbsp;
  <a aria-label="Subscribe to Expo on YouTube" href="https://www.youtube.com/channel/UCx_YiR733cfqVPRsQ1n8Fag" target="_blank">
    <img alt="Expo on YouTube" src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=YouTube&logoColor=white" />
  </a>
</p>

---

EAS CLI is the command-line interface for [Expo Application Services (EAS)](https://expo.dev/eas) — deeply integrated cloud services for Expo and React Native apps, from the team behind Expo.

It gives you a terminal-native path from source code to production: compile signed Android and iOS binaries in the cloud, submit them to the app stores, push over-the-air updates, deploy web apps and API routes, and automate the entire release process — from your machine or from CI.

## Quick start

Install the CLI, log in to your Expo account, and link your project:

```sh
npm install --global eas-cli
eas login
eas init
```

Then ship:

```sh
# Compile installable Android and iOS binaries in the cloud
eas build --platform all

# Submit the latest builds to Google Play and the App Store
eas submit --platform all

# Push an over-the-air update to your users
eas update --branch production --message "Fix checkout crash"
```

Prefer not to install globally? Every command also works with `npx eas-cli@latest`:

```sh
npx eas-cli@latest build --platform ios
```

New to EAS? Follow [Create your first build](https://docs.expo.dev/build/setup/) for a complete walkthrough.

## What you can do

- **[EAS Build](https://docs.expo.dev/build/introduction/)** (`eas build`) — compile and sign Android and iOS apps with custom native code in the cloud, manage app credentials, and share internal distribution builds.
- **[EAS Submit](https://docs.expo.dev/submit/introduction/)** (`eas submit`) — upload your app to Google Play and App Store Connect with one command.
- **[EAS Update](https://docs.expo.dev/eas-update/introduction/)** (`eas update`) — push JavaScript and asset fixes directly to users, with branches, channels, runtime versions, rollouts, and rollbacks.
- **[EAS Workflows](https://docs.expo.dev/eas/workflows/get-started/)** (`eas workflow`) — automate development and release with CI/CD jobs that build, test, submit, update, and deploy your app from `.eas/workflows`.
- **[EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/)** (`eas deploy`) — deploy Expo Router and React Native web apps and API routes.
- **[EAS Metadata](https://docs.expo.dev/eas/metadata/)** (`eas metadata:push`) — maintain your app store presence from the command line (in preview).
- **Project operations** (`eas env`, `eas credentials`, `eas device`, `eas channel`, …) — manage environment variables, signing credentials, Apple devices, update channels, webhooks, and project settings.

## Version policy

EAS CLI is designed to be installed globally or run with `npx`. Installing `eas-cli` into project dependencies is strongly discouraged because it can cause dependency conflicts that are difficult to debug.

If you want to enforce the `eas-cli` version for your project, use the `"cli.version"` field in [eas.json](https://docs.expo.dev/eas/json/):

```json
{
  "cli": {
    "version": ">=1.0.0"
  },
  "build": {
    // build profiles
  },
  "submit": {
    // submit profiles
  }
}
```

## Learn more

- [EAS documentation](https://docs.expo.dev/eas/) for the full service overview.
- [EAS CLI reference](https://docs.expo.dev/eas/cli/) for command usage, flags, and arguments.
- [Expo dashboard](https://expo.dev/accounts) to view projects, builds, submissions, updates, and workflows.
- [Expo changelog](https://expo.dev/changelog) and [blog](https://expo.dev/blog) for product updates.
- [Discord and Forums](https://chat.expo.dev) for community support.
