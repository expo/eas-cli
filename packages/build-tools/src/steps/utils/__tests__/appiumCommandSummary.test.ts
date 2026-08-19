import { UPSTREAM_APPIUM_COMMANDS as ALL_COMMANDS } from '../appiumCommands.generated';
import { APPIUM_COMMAND_SUMMARIES, humanizeAppiumCommand } from '../appiumCommandSummary';

// Curated commands that base-driver does not declare (driver-level commands that
// only show up through drivers such as XCUITest / UiAutomator2).
const DRIVER_LEVEL_CURATED_COMMANDS = ['background', 'getClipboard', 'setClipboard'];

describe('APPIUM_COMMAND_SUMMARIES coverage', () => {
  it('has a curated summary for every upstream Appium command', () => {
    const missing = ALL_COMMANDS.filter(command => !(command in APPIUM_COMMAND_SUMMARIES));
    expect(missing).toEqual([]);
  });

  it('does not curate a command that no longer exists upstream', () => {
    const upstream = new Set(ALL_COMMANDS);
    const curatedNotUpstream = Object.keys(APPIUM_COMMAND_SUMMARIES)
      .filter(command => !upstream.has(command))
      .sort();
    expect(curatedNotUpstream).toEqual([...DRIVER_LEVEL_CURATED_COMMANDS].sort());
  });

  it('has a non-empty summary for every entry', () => {
    for (const [command, summary] of Object.entries(APPIUM_COMMAND_SUMMARIES)) {
      expect(summary).toBeTruthy();
      expect(summary).not.toBe(command);
    }
  });
});

describe(humanizeAppiumCommand, () => {
  it.each([
    ['getWindowRect', 'Read the screen size'],
    ['getScreenshot', 'Took a screenshot'],
    ['getPageSource', 'Read the screen contents'],
    ['click', 'Tapped an element'],
    ['setValue', 'Typed into an element'],
    ['createSession', 'Started the session'],
    ['deleteSession', 'Ended the session'],
    ['postAcceptAlert', 'Accepted an alert'],
  ])('maps the known command %s to a curated summary', (command, expected) => {
    expect(humanizeAppiumCommand(command)).toBe(expected);
  });

  it.each(['proxyReqRes', 'mobile: scroll', 'getDeviceInfo', ''])(
    'returns the raw command %p when it has no curated summary',
    command => {
      expect(humanizeAppiumCommand(command)).toBe(command);
    }
  );
});
