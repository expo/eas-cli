// Expo CLI uses the same variable name and the same `<cli> <command>` value. Do not change them.
const COMMAND_PATTERN = /^(expo|eas) [\w:-]+$/;

/**
 * Makes child processes and nested EAS commands report `command` as their parent command.
 *
 * `parentCommand` is the Expo CLI or EAS CLI command that started the current one. Any other
 * inherited value is dropped. `restoreParentCommand` puts the inherited value back.
 */
export function markAsParentCommand(command: string): {
  parentCommand: string | null;
  restoreParentCommand: () => void;
} {
  const inheritedCommand = process.env.EXPO_PARENT_COMMAND;
  process.env.EXPO_PARENT_COMMAND = command;

  return {
    parentCommand:
      inheritedCommand !== undefined && COMMAND_PATTERN.test(inheritedCommand)
        ? inheritedCommand
        : null,
    restoreParentCommand: () => {
      if (inheritedCommand === undefined) {
        delete process.env.EXPO_PARENT_COMMAND;
      } else {
        process.env.EXPO_PARENT_COMMAND = inheritedCommand;
      }
    },
  };
}
