# CLAUDE.md - eas-cli

This file provides guidance for working with the **eas-cli** package.

## Overview

The main CLI tool for Expo Application Services (EAS). Published as `eas-cli` on npm.

- **95+ commands** organized by domain
- Built on **oclif** (Open CLI Framework)
- Entry point: `bin/run`

## Development Commands

### Running Locally

```bash
# From repository root:
yarn eas <command>

# Or use the binary directly:
packages/eas-cli/bin/run <command>

# Recommended alias for development:
alias easd="$(pwd)/packages/eas-cli/bin/run"
easd build --help
```

### Build & Development

```bash
yarn build                    # TypeScript compilation (src → build)
yarn watch                    # Watch mode
yarn watch-allow-unused       # Watch mode with relaxed TS rules
yarn typecheck                # Type check without building
yarn typecheck-for-build      # Type check for production build
```

### Testing

```bash
yarn test                     # Run all tests
yarn test <path-to-file>      # Run specific test file
```

### GraphQL Code Generation

```bash
yarn generate-graphql-code    # Generate TypeScript types from GraphQL schema
yarn verify-graphql-code      # Verify GraphQL code is up to date (CI check)
```

The GraphQL schema is fetched from `https://staging-api.expo.dev/graphql` and generates:

- `src/graphql/generated.ts` - 499KB+ of TypeScript types
- Types for all queries, mutations, and fragments

### oclif Commands

```bash
yarn oclif readme             # Auto-generate README.md from command metadata
```

## Command Architecture

### Base Command Class

All commands extend `EasCommand` (in `src/commandUtils/EasCommand.ts`).

### Context System

Commands declare required context via `ContextOptions`. This is a powerful system that provides commands with pre-initialized resources based on their needs.

Available context types:

- **LoggedIn**: Requires authentication
  - Provides: `actor` (user info), `graphqlClient` (authenticated GraphQL client)
- **MaybeLoggedIn**: Optional authentication
  - Provides: `actor` (may be undefined), `graphqlClient`
- **ProjectConfig**: Requires project with app.json/app.config
  - Provides: `projectId`, `exp` (Expo config), project directory
- **ProjectDir**: Project directory context
  - Provides: `projectDir`, `projectRoot`
- **VcsClient**: Version control system integration
  - Provides: `vcsClient` (Git operations)
- **ServerSideEnvironmentVariables**: Environment variable management
  - Provides: methods to interact with server-side env vars

Example command structure:

```typescript
import EasCommand from '../../commandUtils/EasCommand';

export default class Build extends EasCommand {
  static override description = 'start a build';

  static override ContextOptions = {
    ...EasCommand.ContextOptions.LoggedIn, // Requires auth
    ...EasCommand.ContextOptions.ProjectConfig, // Requires project
  };

  async runAsync(): Promise<void> {
    // Context is automatically initialized
    const { graphqlClient } = await this.getContextAsync(LoggedIn, {
      nonInteractive: false,
    });

    const { projectId, exp } = await this.getContextAsync(ProjectConfig, {
      nonInteractive: false,
    });

    // Your command logic here
  }
}
```

### Command Discovery

- **Location**: Commands are auto-discovered from `build/commands/` by oclif
- **Manifest**: `oclif.manifest.json` is generated during `prepack`
- **Topics**: Organized into topics (account, build, channel, update, etc.)

## API Architecture

### GraphQL API (Primary)

**Location**: `src/graphql/`

**Client**: `ExpoGraphqlClient` (urql-based wrapper)

- Automatic retry logic with exponential backoff
- Cache management (cache-first vs network-only)
- Transient error handling
- Authentication via Bearer token or session secret

**Structure**:

```
src/graphql/
├── generated.ts           # Generated TypeScript types
├── queries/              # 24+ query modules
├── mutations/            # 17+ mutation modules
└── types/                # GraphQL fragments
```

**Making GraphQL Requests**:

```typescript
// In a command with LoggedIn context:
const { graphqlClient } = await this.getContextAsync(LoggedIn, {
  nonInteractive: false,
});

const result = await graphqlClient.query(MyQuery, { variables: { id: projectId } }).toPromise();

if (result.error) {
  throw new Error(result.error.message);
}

const data = result.data;
```

### REST API v2 (Legacy)

**Client**: `ApiV2Client` in `src/api.ts`

**Base URLs**:

- Production: `https://api.expo.dev`
- Staging: `https://staging-api.expo.dev` (set `EXPO_STAGING=1`)
- Local: `http://127.0.0.1:3000` (set `EXPO_LOCAL=1`)

**Methods**: GET, POST, PUT, DELETE

**Error Handling**: `ApiV2Error` wrapper

## Directory Structure

```
src/
├── commands/           # CLI command implementations (organized by domain)
│   ├── account/       # Login, logout, account management
│   ├── build/         # Build orchestration commands
│   ├── branch/        # Update branch management
│   ├── channel/       # Update channel management
│   ├── credentials/   # iOS/Android credential management
│   ├── deploy/        # Deployment commands
│   ├── device/        # Apple device management
│   ├── env/           # Environment variable management
│   ├── fingerprint/   # Fingerprint comparison/generation
│   ├── metadata/      # App store metadata management
│   ├── project/       # Project initialization and info
│   ├── secret/        # Secret management (legacy)
│   ├── submit/        # App store submission
│   ├── update/        # EAS Update management
│   ├── webhook/       # Webhook management
│   └── workflow/      # Workflow management
├── commandUtils/      # Base command classes and shared utilities
├── build/             # Build orchestration logic
├── credentials/       # Credential management system
├── project/           # Project configuration and publishing
├── update/            # EAS Update functionality
├── submit/            # App store submission logic
├── user/              # Authentication and user management
├── graphql/           # GraphQL queries, mutations, and types
├── analytics/         # Rudder Analytics integration
├── vcs/               # Version control abstraction (Git)
└── utils/             # Shared utilities
```

## Common Patterns

### Working with eas.json

```typescript
import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';

// Read eas.json
const accessor = EasJsonAccessor.fromProjectPath(projectDir);
const easJson = await EasJsonUtils.readAsync(projectDir);

// Access build profiles
const buildProfile = easJson.build?.[profileName];
```

### Project Context

```typescript
// In a command with ProjectConfig context:
const { projectId, exp } = await this.getContextAsync(ProjectConfig, {
  nonInteractive: false,
});

// projectId: EAS project ID
// exp: Parsed Expo config (app.json/app.config.js)
```

### Authentication Flow

1. **SessionManager** handles login/logout (`src/user/SessionManager.ts`)
2. Authentication methods:
   - Interactive login
   - SSO via browser launcher
   - Session secrets
   - Access tokens
3. Credentials stored via `UserSettings`

### Feature Flags

- Server-side feature gating via `FeatureGating` class
- Environment variable overrides via `FeatureGateEnvOverrides`
- Retrieved from Actor during authentication

### Error Handling

Extend `CommandError` or use specific error classes in `src/commandUtils/errors.ts`:

```typescript
import { CommandError } from '../commandUtils/errors';

throw new CommandError('BUILD_FAILED', 'The build failed due to...');
```

### Analytics

- **Provider**: Rudder Analytics (`@expo/rudder-sdk-node`)
- Events tracked for builds, submissions, commands
- User can opt-out via settings

## Testing

- **Location**: `__tests__/` directories alongside source files
- **Mocking**:
  - File system: `memfs`
  - HTTP: `nock`
  - Utilities: `ts-mockito`, `mockdate`

Example test:

```typescript
import { vol } from 'memfs';
import nock from 'nock';

describe('MyCommand', () => {
  beforeEach(() => {
    vol.reset();
    nock.cleanAll();
  });

  it('should do something', async () => {
    // Test implementation
  });
});
```

## Important Notes

- **oclif**: Commands auto-discovered from `build/commands/`
- **README**: Auto-generated from oclif - update via `yarn oclif readme`
- **Manifest**: Generated during `prepack` step
- **Templates**: `src/commandUtils/new/templates` are copied to `build/` during build
- **Node Version**: >= 18.0.0
