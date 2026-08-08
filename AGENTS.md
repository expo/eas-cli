# AGENTS.md

When working with this repository follow instructions from CLAUDE.md.

- [./CLAUDE.md](./CLAUDE.md)
- Before committing, run the formatter on modified files.

## Cursor Cloud specific instructions

### Environment

- **Node.js**: v22+ (provided by nvm in the VM)
- **Yarn**: 4.12.0 (activated via `corepack enable && corepack install`)
- The update script runs `corepack enable`, `corepack install`, `yarn install`, and `yarn build` automatically on VM startup.

### Key development commands

All standard commands are documented in [CLAUDE.md](./CLAUDE.md). Quick reference:

| Task         | Command                          |
| ------------ | -------------------------------- |
| Install deps | `yarn install`                   |
| Build all    | `yarn build`                     |
| Watch mode   | `yarn start`                     |
| Lint         | `yarn lint`                      |
| Format check | `yarn fmt:check`                 |
| Format fix   | `yarn fmt`                       |
| Typecheck    | `yarn typecheck`                 |
| Test all     | `yarn test`                      |
| Test one pkg | `cd packages/<pkg> && yarn test` |
| Run CLI      | `yarn eas <command>`             |

### Non-obvious caveats

- After `yarn install`, you **must** run `yarn build` before tests or the CLI will work. The build step compiles TypeScript for all packages and cross-package imports rely on the compiled output.
- The `yarn test` worker process warning about force exit is a known, benign issue — all tests pass.
- The CLI runs without authentication for most diagnostic/help commands. Commands that interact with the Expo API require `yarn eas login` or `EXPO_TOKEN` env var.
- No Docker, databases, or external services are needed — all tests are fully mocked.
- Oxlint reports 7 pre-existing warnings (missing return types in test files and a sort-imports issue). These are not errors.
