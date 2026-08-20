import { APPIUM_COMMAND_SUMMARIES, humanizeAppiumCommand } from '../appiumCommandSummary';

// Coverage of the generated Appium and driver command sets is enforced at compile time by the
// `Record<AppiumCommand, string>` type in appiumCommandSummary.ts, so it is not
// re-checked here.

describe('APPIUM_COMMAND_SUMMARIES', () => {
  it('has a non-empty summary that differs from the command name for every entry', () => {
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
    ['mobileScroll', 'Scrolled the screen'],
    ['openNotifications', 'Opened notifications'],
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
