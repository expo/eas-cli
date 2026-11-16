import { markAsParentCommand } from '../parentCommand';

const originalParentCommand = process.env.__EXPO_PARENT_COMMAND;

function setInheritedCommand(inheritedCommand: string | undefined): void {
  if (inheritedCommand === undefined) {
    delete process.env.__EXPO_PARENT_COMMAND;
  } else {
    process.env.__EXPO_PARENT_COMMAND = inheritedCommand;
  }
}

afterEach(() => {
  setInheritedCommand(originalParentCommand);
});

it('returns the inherited parent command', () => {
  setInheritedCommand('expo run:ios');

  expect(markAsParentCommand('eas build').parentCommand).toBe('expo run:ios');
});

it.each([undefined, ''])(
  'returns no parent command when the inherited value is %p',
  inheritedCommand => {
    setInheritedCommand(inheritedCommand);

    expect(markAsParentCommand('eas build').parentCommand).toBeNull();
  }
);

it.each([undefined, '', 'expo run:ios'])(
  'marks the command until the inherited value %p is restored',
  inheritedCommand => {
    setInheritedCommand(inheritedCommand);

    const { restoreParentCommand } = markAsParentCommand('eas build');
    expect(process.env.__EXPO_PARENT_COMMAND).toBe('eas build');

    restoreParentCommand();
    expect(process.env.__EXPO_PARENT_COMMAND).toBe(inheritedCommand);
  }
);
