# AGENTS.md

This file provides guidance for AI coding agents working with this Expo project.

## Project Overview

This is an **Expo starter template** created with `create-expo-app`. It's designed to help new developers quickly start building mobile applications with:

- **Expo SDK 54** with the New Architecture enabled
- **Expo Router** for file-based navigation
- **TypeScript** for type safety
- **EAS (Expo Application Services)** integration for build, submit, and deployment workflows
- Pre-configured components, hooks, and theming

This template is meant to become a full-fledged application for many users. Treat it as a production-ready starting point, not just a demo.

## Documentation Resources

When working on this project, **always consult the official Expo documentation** available at:

- **https://docs.expo.dev/llms.txt** - Index of all available documentation files
- **https://docs.expo.dev/llms-full.txt** - Complete Expo documentation including Expo Router, Expo Modules API, development process
- **https://docs.expo.dev/llms-eas.txt** - Complete EAS (Expo Application Services) documentation
- **https://docs.expo.dev/llms-sdk.txt** - Complete Expo SDK documentation

These documentation files are specifically formatted for AI agents and should be your **primary reference** for:

- Expo APIs and best practices
- Expo Router navigation patterns
- EAS Build, Submit, and Update workflows
- Expo SDK modules and their usage
- Development and deployment processes

## Project Structure

```
/
├── app/                    # Expo Router file-based routing
│   ├── (tabs)/            # Tab-based navigation screens
│   │   ├── index.tsx      # Home screen
│   │   ├── explore.tsx    # Explore screen
│   │   └── _layout.tsx    # Tabs layout
│   ├── _layout.tsx        # Root layout with theme provider
│   └── modal.tsx          # Modal screen example
├── components/            # Reusable React components
│   ├── ui/               # UI primitives (IconSymbol, Collapsible)
│   └── ...               # Feature components (themed, haptic, parallax)
├── constants/            # App-wide constants (theme, colors)
├── hooks/                # Custom React hooks (color scheme, theme)
├── assets/               # Static assets (images, fonts)
├── scripts/              # Utility scripts (reset-project)
├── .eas/workflows/       # EAS Workflows (CI/CD automation)
├── app.json             # Expo configuration
├── eas.json             # EAS Build/Submit configuration
└── package.json         # Dependencies and scripts
```

## Key Technologies

### Core Stack

- **React 19.1.0** with React Compiler enabled
- **React Native 0.81.4** with New Architecture
- **Expo SDK 54**
- **Expo Router 6** for navigation with typed routes
- **TypeScript 5.9** with strict mode

### Notable Features

- **File-based routing** via Expo Router
- **Typed routes** for type-safe navigation
- **Dark mode support** with automatic theme switching
- **React Compiler** for optimized performance
- **SF Symbols** support via `expo-symbols`
- **Haptic feedback** via `expo-haptics`
- **Reanimated 4** for animations

## Development Guidelines

### 1. Navigation & Routing

- Use **Expo Router** for all navigation
- Follow file-based routing conventions in `app/` directory
- Use `(groups)` for layout grouping (e.g., `(tabs)`)
- Leverage typed routes for type-safe navigation
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`

### 2. Styling & Theming

- Use the `ThemedText` and `ThemedView` components for automatic dark/light mode support
- Theme colors are defined in `constants/theme.ts`
- Access theme with `useColorScheme()` hook
- Follow React Native's StyleSheet API
- Prefer platform-agnostic styling unless platform-specific is necessary

### 3. Components

- Use **functional components** with hooks
- Keep components small, focused, and reusable
- Place shared components in `components/` directory
- Use TypeScript for all component props
- Follow the existing naming conventions (kebab-case for files, PascalCase for components)

### 4. Path Aliases

- Use `@/` alias for imports (configured in `tsconfig.json`)
- Example: `import { ThemedText } from '@/components/themed-text'`

### 5. Assets

- Place images in `assets/images/`
- Use `expo-image` for optimized image loading
- Use `expo-symbols` for SF Symbols on iOS

### 6. Code Style

- Follow the existing ESLint configuration (`eslint-config-expo`)
- Use TypeScript strict mode
- Prefer modern ES6+ syntax
- Use async/await over promises where appropriate

## EAS Workflows Integration

This project is pre-configured with **EAS Workflows** for automating development and release processes. Workflows are defined in `.eas/workflows/` directory.

### Available NPM Scripts

```bash
# Development
npm run start         # Start Expo dev server
npm run ios           # Start on iOS simulator
npm run android       # Start on Android emulator
npm run web           # Start web version

# EAS Workflows (Cloud CI/CD)
npm run draft              # Publish preview update and website (workflow)
npm run development-builds # Create development builds (workflow)
npm run deploy             # Deploy to production (workflow)

# Code Quality
npm run lint          # Run ESLint

# Utilities
npm run reset-project # Reset to blank template
```

### EAS Workflows Documentation

When working with EAS Workflows, **always refer to**:

- https://docs.expo.dev/llms-eas.txt for EAS-specific documentation
- https://docs.expo.dev/eas/workflows/ for workflow examples
- The `.eas/workflows/` directory for existing workflow configurations

### Build Profiles (eas.json)

- **development**: Development builds with dev client
- **development-simulator**: Development builds for iOS simulator
- **preview**: Internal distribution preview builds
- **production**: Production builds with auto-increment

## Troubleshooting

### Expo Go Errors & Development Builds

If users are experiencing errors in **Expo Go** or their project is not running, they may need to create a **development build**, especially if they have:

- Added new packages that rely on **config plugins**
- Added libraries with **native code**
- Modified native configuration in `app.json`
- Upgraded the Expo SDK version

**Expo Go** is a sandbox environment with a limited set of native modules. When your project requires native code or config plugins not included in Expo Go, you need to create a development build.

#### How to Create a Development Build:

1. Install `expo-dev-client`:

   ```bash
   npx expo install expo-dev-client
   ```

2. Run the development build workflow:

   ```bash
   npm run development-builds
   ```

3. Or build locally:
   ```bash
   npx expo run:ios
   # or
   npx expo run:android
   ```

**Learn more**: https://docs.expo.dev/develop/development-builds/expo-go-to-dev-build/

## Common Tasks

### Adding a New Screen

1. Create a new file in `app/` (e.g., `app/profile.tsx`)
2. Export a default React component
3. Add navigation link: `<Link href="/profile">Profile</Link>`

### Adding a New Tab

1. Create a new file in `app/(tabs)/` (e.g., `app/(tabs)/settings.tsx`)
2. Update `app/(tabs)/_layout.tsx` to include the new tab

### Installing a New Expo Module

1. Use `npx expo install <package-name>` (not `npm install`)
2. This ensures version compatibility with your Expo SDK
3. Check https://docs.expo.dev/llms-sdk.txt for module documentation

### Using EAS Workflows

1. Explore workflows in `.eas/workflows/` directory
2. Run workflows via NPM scripts: `npm run draft`, `npm run development-builds`, `npm run deploy`
3. Consult https://docs.expo.dev/llms-eas.txt for customization

### Creating Development Builds

1. Ensure prerequisites are met (see README.md)
2. Run `npm run development-builds`
3. Follow the EAS Workflow prompts

## Important Notes

### DO:

- ✅ Always use `npx expo install` for installing packages
- ✅ Consult https://docs.expo.dev/llms-full.txt before implementing Expo features
- ✅ Use the `@/` import alias for cleaner imports
- ✅ Follow Expo and React Native best practices
- ✅ Keep the New Architecture compatibility in mind
- ✅ Use TypeScript for type safety
- ✅ Test on multiple platforms when possible
- ✅ Leverage EAS Workflows for CI/CD automation

### DON'T:

- ❌ Don't use `npm install` directly (use `npx expo install` instead)
- ❌ Don't install packages incompatible with the current Expo SDK
- ❌ Don't bypass Expo Router for navigation
- ❌ Don't hardcode colors (use theme system)
- ❌ Don't ignore TypeScript errors
- ❌ Don't add native code without understanding Expo's module system
- ❌ Don't modify `app.json` without checking Expo documentation

## Resources

- **Expo Documentation**: https://docs.expo.dev
- **Expo Router**: https://docs.expo.dev/router/introduction/
- **EAS Documentation**: https://docs.expo.dev/eas/
- **EAS Workflows**: https://docs.expo.dev/eas/workflows/
- **React Native**: https://reactnavigation.org
- **Community**: https://chat.expo.dev (Discord)

## AI Agent Instructions

When working on this project:

1. **Always start by consulting the appropriate documentation**:

   - For general Expo questions: https://docs.expo.dev/llms-full.txt
   - For EAS/deployment questions: https://docs.expo.dev/llms-eas.txt
   - For SDK/API questions: https://docs.expo.dev/llms-sdk.txt

2. **Understand before implementing**: Read the relevant docs section before writing code

3. **Follow existing patterns**: Look at existing components and screens for patterns to follow

4. **Be explicit**: Provide clear explanations for any changes or additions

5. **Consider the user**: Remember this is a template for new developers - keep code clear and well-commented

6. **Maintain consistency**: Follow the established file structure and naming conventions
