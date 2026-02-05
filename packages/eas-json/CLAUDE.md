# CLAUDE.md - eas-json

This file provides guidance for working with the **@expo/eas-json** package.

## Overview

A library for parsing and validating `eas.json` configuration files. Published as `@expo/eas-json` on npm.

- Validates `eas.json` configuration files using **Joi schemas**
- Manages build, submit, and deploy profiles
- Supports **JSON5** via golden-fleece
- Used by eas-cli and other Expo tools

## Development Commands

```bash
bun run build       # TypeScript compilation (src → build)
bun run watch       # Watch mode
bun run typecheck   # Type check
bun run test        # Run tests
```

## Architecture

### Schema Validation

The package uses **Joi** for schema validation:

**Location**: `src/schema.ts`

The schema defines valid structure for:
- Build profiles
- Submit profiles
- Deploy profiles
- CLI version constraints

### JSON5 Support

Uses **golden-fleece** library to support JSON5 syntax in `eas.json`:
- Comments
- Trailing commas
- Unquoted keys
- Single quotes

## Common Usage Patterns

### Reading eas.json

```typescript
import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';

// Read eas.json from project directory
const easJson = await EasJsonUtils.readAsync(projectDir);

// Access build profiles
const buildProfile = easJson.build?.[profileName];
if (!buildProfile) {
  throw new Error(`Build profile "${profileName}" not found`);
}

// Access submit profiles
const submitProfile = easJson.submit?.[profileName];

// Check CLI version constraint
const cliVersion = easJson.cli?.version;
```

### Using EasJsonAccessor

```typescript
import { EasJsonAccessor } from '@expo/eas-json';

// Create accessor from project path
const accessor = EasJsonAccessor.fromProjectPath(projectDir);

// Read raw eas.json
const rawJson = await accessor.readRawAsync();

// Read and validate eas.json
const easJson = await accessor.readAsync();

// Write eas.json
await accessor.writeAsync(easJson);
```

### Validating eas.json

```typescript
import { validateEasJsonAsync } from '@expo/eas-json';

try {
  await validateEasJsonAsync(projectDir);
  console.log('eas.json is valid');
} catch (error) {
  console.error('Validation error:', error.message);
}
```

## Schema Structure

### Build Profiles

Build profiles can contain:
- `distribution`: Distribution type (store, internal, simulator)
- `platform`: Platform-specific configuration (iOS/Android)
- `env`: Environment variables
- `node`: Node.js version
- `yarn`: Yarn version
- `npm`: npm version
- `cache`: Cache configuration
- And many more build-specific options

### Submit Profiles

Submit profiles contain app store submission configuration:
- iOS: App Store Connect credentials, ASC App ID
- Android: Google Service Account key, track

### Deploy Profiles

Deploy profiles for EAS Deploy (worker deployments):
- `region`: Deployment region
- `nodeVersion`: Node.js version
- Environment configuration

## Important Notes

- **JSON5**: Full JSON5 syntax support via golden-fleece
- **Validation**: Joi schema validation with helpful error messages
- **Types**: Comprehensive TypeScript types exported
- **CLI Version**: Supports enforcing eas-cli version via `cli.version` field
