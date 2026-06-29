<!-- Title -->

<p align="center">
  <a href="https://expo.dev/eas">
    <img alt="EAS" height="96" src=".github/resources/eas.png">
  </a>
</p>

<h1 align="center">EAS CLI</h1>

<p align="center">Ship Expo and React Native apps from your terminal: build, submit, update, deploy, and automate with EAS.</p>

<p align="center">
  <a aria-label="EAS documentation" href="https://docs.expo.dev/eas/">Documentation</a>
  &nbsp;|&nbsp;
  <a aria-label="EAS CLI reference" href="https://docs.expo.dev/eas/cli/">CLI Reference</a>
  &nbsp;|&nbsp;
  <a aria-label="EAS Build" href="https://docs.expo.dev/build/introduction/">Build</a>
  &nbsp;|&nbsp;
  <a aria-label="EAS Update" href="https://docs.expo.dev/eas-update/introduction/">Update</a>
  &nbsp;|&nbsp;
  <a aria-label="EAS Workflows" href="https://docs.expo.dev/eas/workflows/get-started/">Workflows</a>
  &nbsp;|&nbsp;
  <a aria-label="Expo changelog" href="https://expo.dev/changelog">Changelog</a>
</p>

<p align="center">
  <a aria-label="npm version" href="https://www.npmjs.com/package/eas-cli" target="_blank">
    <img alt="npm version" src="https://img.shields.io/npm/v/eas-cli.svg?style=for-the-badge&label=npm&labelColor=000000&color=4630EB" />
  </a>
  <a aria-label="npm downloads" href="https://www.npmtrends.com/eas-cli" target="_blank">
    <img alt="downloads" src="https://img.shields.io/npm/dm/eas-cli.svg?style=for-the-badge&labelColor=000000&color=33CC12&label=downloads" />
  </a>
  <a aria-label="License: MIT" href="https://github.com/expo/eas-cli/blob/main/LICENSE" target="_blank">
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-success.svg?style=for-the-badge&labelColor=000000&color=18191B" />
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
  <a aria-label="Follow Expo on LinkedIn" href="https://www.linkedin.com/company/expo-dev" target="_blank">
    <img alt="Expo on LinkedIn" src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=LinkedIn&logoColor=white" />
  </a>&nbsp;
  <a aria-label="Subscribe to Expo on YouTube" href="https://www.youtube.com/channel/UCx_YiR733cfqVPRsQ1n8Fag" target="_blank">
    <img alt="Expo on YouTube" src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=YouTube&logoColor=white" />
  </a>
</p>

---

EAS CLI is the command-line interface for [Expo Application Services](https://expo.dev/eas). It connects your local Expo and React Native projects to hosted services for cloud builds, app store submissions, over-the-air updates, web and API deployments, workflows, environment variables, credentials, and release automation.

Use it when you want a terminal-native path from source code to production: build signed binaries, distribute preview builds, submit to the stores, publish updates, and automate the whole release process from CI.

## Quick start

Install and log in:

```sh
npm install --global eas-cli
eas login
```

Initialize EAS in your project:

```sh
eas init
```

Build installable Android and iOS binaries:

```sh
eas build --platform all
```

Submit a build to the stores:

```sh
eas submit --platform all
```

Publish an update:

```sh
eas update --branch production --message "Fix checkout crash"
```

Prefer not to install globally? Run any command with `npx eas-cli@latest`, for example:

```sh
npx eas-cli@latest build --platform ios
```

## What you can do

- **[EAS Build](https://docs.expo.dev/build/introduction/)**: compile and sign Android and iOS binaries in the cloud, manage credentials, share internal builds, and run local builds when you need to debug.
- **[EAS Submit](https://docs.expo.dev/submit/introduction/)**: upload Android and iOS builds to Google Play and App Store Connect from the command line or after a successful build.
- **[EAS Update](https://docs.expo.dev/eas-update/introduction/)**: ship JavaScript and asset changes directly to users with channels, branches, runtime versions, rollouts, and rollbacks.
- **[EAS Workflows](https://docs.expo.dev/eas/workflows/get-started/)**: define CI/CD jobs for builds, submissions, tests, deployments, and custom automation in `.eas/workflows`.
- **[EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/)**: deploy Expo Router and React Native web apps, API routes, aliases, and custom domains.
- **Project operations**: manage environment variables, app credentials, store metadata, update channels, webhooks, devices, project settings, and observability from one CLI.

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
