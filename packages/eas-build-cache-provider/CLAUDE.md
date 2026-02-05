# CLAUDE.md - eas-build-cache-provider

This file provides guidance for working with the **eas-build-cache-provider** package.

## Overview

A build cache provider plugin for Expo CLI. Published as `eas-build-cache-provider` on npm.

- Provides remote caching for Expo builds
- Optimizes build times by caching intermediate build artifacts
- Integrates with EAS infrastructure

## Development Commands

```bash
yarn build          # TypeScript compilation (src → build)
yarn watch          # Watch mode
yarn typecheck      # Type check
yarn test           # Run tests
```

## Usage

### Installation

Install as a dev dependency in your Expo project:

```bash
npm install --save-dev eas-build-cache-provider
# or
yarn add --dev eas-build-cache-provider
```

### Configuration

Update your **app.json** to enable the EAS build cache provider:

```json
{
  "expo": {
    "experiments": {
      "buildCacheProvider": "eas"
    }
  }
}
```

## How It Works

The build cache provider:

1. Hooks into Expo CLI's build process
2. Uploads build cache artifacts to EAS infrastructure
3. Downloads cached artifacts on subsequent builds
4. Improves build times by reusing cached dependencies and build outputs

## Important Notes

- **Experimental**: This is an experimental feature
- **EAS Integration**: Requires EAS account and project setup
- **Cache Scope**: Cache is scoped per project and platform
