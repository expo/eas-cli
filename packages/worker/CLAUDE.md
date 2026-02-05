# CLAUDE.md - worker

This file provides guidance for working with the **worker** package.

## Overview

Turtle Worker is a service running on every EAS build worker VM or pod. It's a **private package** (not published to npm).

- Exposes a **WebSocket server** to communicate with Turtle Launcher
- Wrapper for `@expo/build-tools` library
- Receives build requests and handles actual React Native project builds
- Runs on EAS build infrastructure (VMs/pods)

## Development Commands

### Setup
```bash
# Copy environment configuration
cp ./.direnv/local/.envrc.example ./.direnv/local/.envrc

# Fill out the .envrc file with your secrets
# Then load it with direnv or source it manually

# Install dependencies (from repo root)
bun install

# Build
bun run build
```

### Development
```bash
bun run start       # Start the worker in development mode

# If you made changes in packages from libs/ directory:
# Type 'rs' in the console and press ENTER
# Or press CTRL+C, then UP arrow, then ENTER to restart
```

### Testing
```bash
bun run test        # Run unit tests
```

## Architecture

### WebSocket Communication

The worker communicates with Turtle Launcher via WebSocket messages.

**Message Types** (defined in `/src/libs/turtle-common/src/messages.ts`):

1. **state-query** (launcher → worker)
   - Launcher queries current worker state

2. **state-response** (worker → launcher)
   - Worker responds with current state
   - Possible statuses: `"new"`, `"in-progress"`, `"finished"`

3. **dispatch** (launcher → worker)
   - Launcher dispatches a new build to worker
   - Only sent when worker status is `"new"`

4. **success** / **error** (worker → launcher)
   - Worker reports build completion
   - Contains build results and artifacts

5. **close** (launcher → worker)
   - Launcher initiates graceful shutdown of VM/pod

### Communication Flow

```
┌─────────────┐                    ┌─────────────┐
│   Launcher  │                    │   Worker    │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  state-query                     │
       ├─────────────────────────────────>│
       │                                  │
       │  state-response (status: "new")  │
       │<─────────────────────────────────┤
       │                                  │
       │  dispatch (build request)        │
       ├─────────────────────────────────>│
       │                                  │
       │              (build runs)        │
       │                                  │
       │  success/error (build result)    │
       │<─────────────────────────────────┤
       │                                  │
       │  close (shutdown)                │
       ├─────────────────────────────────>│
       │                                  │
```

### Recovery Process

If the launcher goes down during a build, recovery happens when it comes back:

1. New launcher instance sends `state-query`
2. Worker responds with `state-response` containing current status:
   - If build finished: launcher sends `close` message
   - If build in progress: launcher takes no action, waits for completion

### Build Execution

Worker wraps `@expo/build-tools` library to execute builds:
- Receives build job configuration
- Sets up build environment
- Runs actual React Native build process
- Uploads artifacts
- Reports results back to launcher

## Deployment

### Distribution

Worker code is distributed via **GCS bucket**. Every pod/VM installs it during startup.

**Archive Structure**:
- Contains worker source code from repository
- All other dependencies downloaded from npm at install time

### Deployment Process

**For every commit on main**:
- GitHub Actions creates archives: `worker-{{platform}}-{{hash}}`
- Creates staging archives: `worker-{{platform}}-staging`

**Production Deployment**:
- Guarded with manual `approve` step in GitHub Actions
- Creates copy: `worker-{{platform}}-staging` → `worker-{{platform}}-production`

### Docker Images (Android)

- Built for every PR with changes in `infra/eas-build-worker-images/android/{{ imageName }}`
- Pushed to Docker registry hosted on GCloud

### VM Templates (iOS)

- Built for every PR with changes in `infra/eas-build-worker-images/ios/{{ templateName }}`

## Dependencies

Key dependencies:
- `@expo/build-tools` - Core build execution
- `koa`, `koa-body`, `koa-router` - HTTP server
- `ws` - WebSocket server
- `@sentry/node` - Error tracking

## Important Notes

- **Not Published**: This is a private package, not published to npm
- **Build Output**: `src/` → `dist/`
- **WebSocket**: Primary communication method with launcher
- **Stateful**: Maintains build state for recovery scenarios
- **Infrastructure**: Runs on EAS build VMs (iOS) and pods (Android)
