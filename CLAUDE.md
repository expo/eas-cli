# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a **Lerna-based monorepo** with four packages:

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

4. **[packages/worker](./packages/worker/CLAUDE.md)** - Turtle Worker service (private, not published)
   - Runs on EAS build VMs/pods
   - WebSocket server for communication with Turtle Launcher
   - Wraps `@expo/build-tools` to execute actual React Native builds

> **Note**: Each package has its own CLAUDE.md with package-specific guidance. Click the links above to view them.

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
yarn test           # Run all tests across packages (Jest multi-project)
yarn test --watch   # Run tests in watch mode

# Run tests for specific package
cd packages/eas-cli && yarn test
cd packages/eas-json && yarn test
cd packages/worker && yarn test
```

### Type Checking & Linting
```bash
yarn typecheck      # TypeScript type check all packages
yarn lint           # ESLint across all packages
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

## Build System

Each package has independent TypeScript compilation:
- `eas-cli`: `src/` → `build/`
- `eas-json`: `src/` → `build/`
- `eas-build-cache-provider`: `src/` → `build/`
- `worker`: `src/` → `dist/`

TypeScript configs:
- `tsconfig.json` - Base configuration (extends @tsconfig/node18)
- `tsconfig.build.json` - Production builds
- `tsconfig.allowUnused.json` - Development with relaxed rules

## Testing Architecture

- **Framework**: Jest with multi-project configuration
- **Root config**: `jest.config.ts` (combines eas-cli, eas-json, worker)
- **Test locations**: `__tests__/` directories alongside source files
- **Mocking**:
  - File system: `memfs`
  - HTTP: `nock`
  - Utilities: `ts-mockito`, `mockdate`

Run a single test file:
```bash
yarn test <path-to-test-file>
# Example:
yarn test packages/eas-cli/src/project/__tests__/projectUtils-test.ts
```

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
yarn lint           # Run ESLint
```

### Logging
Use the `Log` module from `@expo/logger`:
```typescript
import { Log } from '@expo/logger';

Log.log('Info message');
Log.warn('Warning message');
Log.error('Error message');
```

## Release Process

1. Update `CHANGELOG.md` in the appropriate package
2. Version bump is automated based on changelog:
   - Breaking changes → MAJOR
   - New features → MINOR
   - Otherwise → PATCH
3. GitHub Actions workflow handles release automation
4. Notifications sent to Slack #eas-cli channel

## Important Notes

- **Node Version**: Requires Node.js >= 18.0.0 (managed via Volta)
- **Package Manager**: Uses Yarn 1.22.21
- **Compilation Target**: CommonJS with Node resolution
