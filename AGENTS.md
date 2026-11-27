# AGENTS.md

When working with this repository follow instructions from CLAUDE.md.

- [./CLAUDE.md](./CLAUDE.md)
- Before committing, run the formatter on modified files.
- When adding or removing a simulator command under `packages/eas-cli/src/commands/simulator/`, update `SIMULATOR_COMMAND_BENCHMARKS` in `packages/eas-cli/scripts/benchmark-simulator-commands.js` (enforced by `packages/eas-cli/src/commands/simulator/__tests__/benchmarkCoverage.test.ts`).
- When contributing to or modifying `eas simulator` commands (or their startup path), review the simulator speed benchmark (`cd packages/eas-cli && yarn benchmark:simulator` locally and the PR benchmark comment) and actively pay attention to startup latency, eager imports, telemetry/network overhead, and CLI responsiveness.
