# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a **Lerna-based monorepo** containing the EAS CLI and all supporting build libraries.

### CLI & Configuration Packages

1. **[packages/eas-cli](./packages/eas-cli/CLAUDE.md)** - The main CLI tool (published as `eas-cli`)
   - 95+ commands organized by domain (build, submit, update, channel, credentials, etc.)
   - Built on oclif (Open CLI Framework)
   - Entry point: `packages/eas-cli/bin/run`

2. **[packages/eas-json](./packages/eas-json/CLAUDE.md)** - EAS configuration parser (published as `@expo/eas-json`)
   - Validates `eas.json` configuration files using Joi schemas
   - Manages build, submit, and deploy profiles
   - Supports JSON5 via golden-fleece

3. **[packages/eas-build-cache-provider](./packages/eas-build-cache-provider/CLAUDE.md)** - Build cache plugin (published as `eas-build-cache-provider`)
   - Optimizes build caching for Expo CLI

### Build Execution Packages

4. **[packages/eas-build-job](./packages/eas-build-job)** - Build job definitions (published as `@expo/eas-build-job`)
   - Defines all data structures for build operations (Job, BuildPhase, BuildMode, Platform, Workflow)
   - Provides type definitions and validation schemas (Zod, Joi)
   - Contains BuildPhase enum that defines the traditional build pipeline stages
   - Key exports: `Job`, `BuildPhase`, `BuildMode`, `BuildTrigger`, `Workflow`, `ArchiveSource`
   - **Foundation that all other build packages depend on**

5. **[packages/build-tools](./packages/build-tools)** - Build execution engine (published as `@expo/build-tools`)
   - Orchestrates all build operations through `BuildContext<T extends Job>`
   - Contains platform-specific builders: `androidBuilder()`, `iosBuilder()`, `runCustomBuildAsync()`
   - Manages build phases, artifact uploading, caching, credentials
   - Provides functions for custom builds
   - Integrates with GraphQL API

6. **[packages/steps](./packages/steps)** - Custom build workflow engine (published as `@expo/steps`)
   - Framework for defining and executing custom build steps
   - Key abstractions:
     - `BuildWorkflow`: Orchestrates sequential step execution
     - `BuildStep`: Individual executable unit with inputs/outputs
     - `BuildStepGlobalContext`: Manages shared state and interpolation
     - `BuildStepContext`: Per-step execution context
   - Supports conditional execution with `if` expressions (using jsep)
   - Template interpolation: `${{ steps.step-id.outputs.outputName }}`
   - Parses build configs from YAML/JSON

7. **[packages/local-build-plugin](./packages/local-build-plugin)** - Local build execution (published as `eas-cli-local-build-plugin`)
   - Allows running EAS builds locally on developer machines
   - Entry point: `packages/local-build-plugin/src/main.ts`
   - Sets `EAS_BUILD_RUNNER=local-build-plugin` environment variable
   - Reuses all build-tools logic for consistency with cloud builds

8. **[packages/worker](./packages/worker/CLAUDE.md)** - Turtle Worker service (private, not published)
   - Runs on EAS build VMs/pods
   - WebSocket server for communication with Turtle Launcher
   - Wraps `@expo/build-tools` to execute actual React Native builds

### Supporting Packages

9. **[packages/logger](./packages/logger)** - Bunyan-based structured logging (published as `@expo/logger`)
   - Used by all build packages

10. **[packages/downloader](./packages/downloader)** - HTTP file downloading with retry logic (published as `@expo/downloader`)

11. **[packages/turtle-spawn](./packages/turtle-spawn)** - Child process spawning with error handling (published as `@expo/turtle-spawn`)

12. **[packages/template-file](./packages/template-file)** - Lodash-based template string interpolation (published as `@expo/template-file`)

13. **[packages/create-eas-build-function](./packages/create-eas-build-function)** - CLI scaffolding tool for custom build functions (published as `create-eas-build-function`)

14. **[packages/expo-cocoapods-proxy](./packages/expo-cocoapods-proxy)** - Ruby gem for CocoaPods proxy (published as `expo-cocoapods-proxy` gem)

> **Note**: Some packages have their own CLAUDE.md with package-specific guidance. Click the links above to view them.

## Common Development Commands

### Setup

```bash
yarn install        # Install all dependencies
yarn build          # Build all packages in the monorepo
```

### Development

```bash
yarn start          # Watch mode with parallel builds across all packages
yarn watch          # Alias for start

# Development with relaxed TypeScript rules (allows unused variables)
yarn start-allow-unused
```

### Testing

```bash
yarn run -T lerna run test               # Run all tests across packages
yarn run -T lerna run test -- --watch    # Watch mode across packages (heavier)
#
# If you use `yarn test`, remember to pass args through two separators:
# yarn test -- -- --watch

# Run tests for a specific package
cd packages/eas-cli && yarn test
cd packages/eas-json && yarn test
cd packages/worker && yarn test
cd packages/build-tools && yarn test
cd packages/steps && yarn test
```

### Type Checking & Linting

```bash
yarn typecheck      # TypeScript type check all packages
yarn lint           # Oxlint across all packages
yarn fmt:check      # Oxfmt format check
```

### Running EAS CLI Locally

```bash
# From repository root:
yarn eas <command>  # Run via root package script

# Or use the binary directly:
packages/eas-cli/bin/run <command>

# Recommended: Create an alias for development
alias easd="$(pwd)/packages/eas-cli/bin/run"
easd build --help
```

### Local Build Testing

Set up environment variables for testing local builds:

```bash
export EAS_LOCAL_BUILD_PLUGIN_PATH=$HOME/expo/eas-cli/bin/eas-cli-local-build-plugin
export EAS_LOCAL_BUILD_WORKINGDIR=$HOME/expo/eas-build-workingdir
export EAS_LOCAL_BUILD_SKIP_CLEANUP=1
export EAS_LOCAL_BUILD_ARTIFACTS_DIR=$HOME/expo/eas-build-workingdir/results

# Then run build with --local flag in eas-cli
eas build --local
```

## Build System

Each package has independent TypeScript compilation:

- `eas-cli`: `src/` → `build/`
- `eas-json`: `src/` → `build/`
- `eas-build-cache-provider`: `src/` → `build/`
- `worker`: `src/` → `dist/`
- `build-tools`: `src/` → `dist/`
- `eas-build-job`: `src/` → `dist/`
- `steps`: `src/` → `dist/` (CommonJS only)
- `local-build-plugin`: `src/` → `dist/`
- Other packages: `src/` → `dist/`

TypeScript configs:

- `tsconfig.json` - Base configuration (extends @tsconfig/node20)
- `tsconfig.build.json` - Production builds
- `tsconfig.allowUnused.json` - Development with relaxed rules

## Key Architectural Patterns

### Build Phases

Most traditional build operations are wrapped in phases for tracking:

```typescript
await ctx.runBuildPhase(BuildPhase.INSTALL_DEPENDENCIES, async () => {
  // Phase logic here
});
```

Phases can be marked as skipped, warning, or failed for granular reporting.

### Context Objects

- **BuildContext** (`build-tools`): For traditional builds, wraps Job, manages phases/artifacts/caching
- **CustomBuildContext** (`build-tools`): Implements `ExternalBuildContextProvider`, bridges BuildContext to steps framework, used in custom builds and generic jobs
- **BuildStepGlobalContext** (`steps`): Manages step outputs, interpolation, shared state
- **BuildStepContext** (`steps`): Per-step context with working directory and logger

### Custom Build Steps

Steps are defined with:

- `id`: Unique identifier
- `name`: Display name
- `run`: Command or function reference
- `if`: Optional condition (`${{ always() }}`, `${{ success() }}`, etc.)
- `inputs`: Key-value inputs to the step
- `outputs`: Named outputs accessible to later steps

Built-in step functions are in `packages/build-tools/src/steps/functions/`

### Conditional Execution

Uses jsep for expression evaluation:

```yaml
if: ${{ steps.previous_step.outputs.success == 'true' && env.ENVIRONMENT == 'production' }}
```

### Artifact Management

Artifacts tracked as `ArtifactToUpload`:

- Managed artifacts (APK, IPA, AAB) with specific handling
- Generic artifacts for any file
- Upload via `ctx.uploadArtifact()` or `upload-artifact` step

## Package Interdependencies

```
eas-cli → @expo/eas-json
       → @expo/build-tools → @expo/eas-build-job
                           → @expo/steps → @expo/eas-build-job
                           → @expo/logger
                           → @expo/turtle-spawn
                           → @expo/downloader
                           → @expo/template-file

local-build-plugin → @expo/build-tools → @expo/eas-build-job
                   → @expo/turtle-spawn

worker → @expo/build-tools
```

Most packages depend on `@expo/eas-build-job` as the source of truth for types.

## Testing Architecture

- **Framework**: Jest with per-package configuration
- **Shared base config**: `jest/jest.shared.config.ts`
- **Test locations**: `__tests__/` directories alongside source files
- **Mocking**:
  - File system: `memfs`
  - HTTP: `nock`
  - Utilities: `ts-mockito`, `mockdate`

Run a single test file:

```bash
cd packages/eas-cli && yarn test <path-to-test-file>
# Example:
cd packages/eas-cli && yarn test src/project/__tests__/projectUtils-test.ts
```

## Common Development Scenarios

### Adding a Built-in Step Function

1. Create file in `packages/build-tools/src/steps/functions/yourFunction.ts`
2. Export `createYourFunctionBuildFunction()` following existing patterns
3. Add to `getEasFunctions()` in `packages/build-tools/src/steps/functions/easFunctions.ts`
4. Function receives `BuildStepContext` and input/output maps

### Adding Error Detection

1. Add pattern detection in `packages/build-tools/src/buildErrors/detectError.ts`
2. Implement resolver for better error messages
3. Helps users understand and fix build failures

### Working with Platform-Specific Builders

- **Android builder** (`packages/build-tools/src/builders/android.ts`): Gradle-based, handles APK/AAB generation, also see `functionGroups/build.ts`
- **iOS builder** (`packages/build-tools/src/builders/ios.ts`): Fastlane/Xcode-based, handles IPA generation, also see `functionGroups/build.ts`
- Both use `runBuilderWithHooksAsync()` which runs build result hooks (on-success, on-error, on-complete) from package.json

### Introducing Breaking Changes to Job API (@expo/eas-build-job)

If you want to introduce breaking changes to the `@expo/eas-build-job` package, contact one of the CODEOWNERS to coordinate changes with EAS build servers and GraphQL API. Describe what changes you want to make and why. After everything is deployed to production, you can introduce a PR that relies on the new implementation.

## Environment Variables

```bash
# API Configuration
export EXPO_STAGING=1   # Use staging API (https://staging-api.expo.dev)
export EXPO_LOCAL=1     # Use local API (http://127.0.0.1:3000)

# Development
export EAS_NO_VCS=1     # Disable version control checks
export EXPO_DEBUG=1     # Enable debug logging
```

## Code Style & Conventions

### Validation

All changes should be validated with TypeScript and the linter before committing:

```bash
yarn typecheck      # Validate TypeScript types
yarn lint           # Run Oxlint
yarn fmt:check      # Run Oxfmt format check
```

### Logging

Use the `Log` module from `@expo/logger`:

```typescript
import { Log } from '@expo/logger';

Log.log('Info message');
Log.warn('Warning message');
Log.error('Error message');
```

### Pull Request conventions

When creating pull requests, make sure to adhere to [PULL_REQUEST_TEMPLATE](./.github/PULL_REQUEST_TEMPLATE).

### Commit Messages

- When possible, prepend commit messages with `[PACKAGE-BEING-CHANGED]`, e.g. `[steps] Add new step function`
- Do not use prefixes like `chore:` and `feat:`
- Commit messages should be concise. Only complex changes should be longer than one line
- Commit changes in logical groups

## Release Process

1. Update `CHANGELOG.md` in the appropriate package
2. Version bump is automated based on changelog:
   - Breaking changes → MAJOR
   - New features → MINOR
   - Otherwise → PATCH
3. GitHub Actions workflow handles release automation
4. Notifications sent to Slack #eas-cli channel

## Licensing

This repository contains packages under different licenses:

- **MIT License**: `eas-cli`, `@expo/eas-json`, `@expo/eas-build-job`, `eas-build-cache-provider`
- **BUSL-1.1 (Business Source License)**: `@expo/build-tools`, `@expo/steps`, `@expo/logger`, `@expo/downloader`, `@expo/turtle-spawn`, `@expo/template-file`, `eas-cli-local-build-plugin`

See `LICENSE` (MIT) and `LICENSE-BUSL` (BUSL-1.1) for details.

## Important Notes

- **Node Version**: Requires Node.js (managed via Mise)
- **Package Manager**: Uses Yarn 4.12.0
- **Compilation Target**: CommonJS with Node resolution
