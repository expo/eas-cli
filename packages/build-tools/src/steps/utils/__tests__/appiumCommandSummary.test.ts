import { UPSTREAM_APPIUM_COMMANDS as ALL_COMMANDS } from '../appiumCommands.generated';
import { APPIUM_COMMAND_SUMMARIES, humanizeAppiumCommand } from '../appiumCommandSummary';

// Appium commands we intentionally leave to the humanizer fallback instead of a
// curated summary (rare / experimental / web-only endpoints). Kept explicit so the
// coverage test fails when Appium adds a new command upstream, forcing a decision
// to either curate it or add it here.
const COMMANDS_LEFT_TO_FALLBACK = [
  'activateIMEEngine',
  'addAuthCredential',
  'addVirtualAuthenticator',
  'availableIMEEngines',
  'clearDevicePosture',
  'closeWindow',
  'createNewWindow',
  'createVirtualPressureSource',
  'createVirtualSensor',
  'deactivateIMEEngine',
  'deleteCookie',
  'deleteCookies',
  'deleteVirtualPressureSource',
  'deleteVirtualSensor',
  'elementShadowRoot',
  'fedCMCancelDialog',
  'fedCMClickDialogButton',
  'fedCMGetAccounts',
  'fedCMGetDialogType',
  'fedCMGetTitle',
  'fedCMResetCooldown',
  'fedCMSelectAccount',
  'fedCMSetDelayEnabled',
  'findElementFromShadowRoot',
  'findElementsFromShadowRoot',
  'fullScreenWindow',
  'generateTestReport',
  'getActiveIMEEngine',
  'getAppiumSessionCapabilities',
  'getAppiumSessions',
  'getAuthCredential',
  'getCookie',
  'getCookies',
  'getGlobalPrivacyControl',
  'getLogEvents',
  'getVirtualSensorInfo',
  'getWindowHandle',
  'getWindowHandles',
  'isIMEActivated',
  'listCommands',
  'listExtensions',
  'maximizeWindow',
  'minimizeWindow',
  'receiveAsyncResponse',
  'removeAllAuthCredentials',
  'removeAuthCredential',
  'removeVirtualAuthenticator',
  'setCookie',
  'setDevicePosture',
  'setFrame',
  'setGlobalPrivacyControl',
  'setPermissions',
  'setRPHRegistrationMode',
  'setSPCTransactionMode',
  'setStorageAccess',
  'setUserAuthVerified',
  'setWindow',
  'switchToParentFrame',
  'updateVirtualPressureSource',
  'updateVirtualSensorReading',
];

// Curated commands that base-driver does not declare (driver-level commands that
// only show up through drivers such as XCUITest / UiAutomator2).
const DRIVER_LEVEL_CURATED_COMMANDS = ['background', 'getClipboard', 'setClipboard'];

describe('APPIUM_COMMAND_SUMMARIES coverage', () => {
  it('accounts for every upstream Appium command (curated or explicit fallback)', () => {
    const curated = new Set(Object.keys(APPIUM_COMMAND_SUMMARIES));
    const uncategorized = ALL_COMMANDS.filter(
      command => !curated.has(command) && !COMMANDS_LEFT_TO_FALLBACK.includes(command)
    );
    expect(uncategorized).toEqual([]);
  });

  it('does not curate a command that no longer exists upstream', () => {
    const upstream = new Set(ALL_COMMANDS);
    const curatedNotUpstream = Object.keys(APPIUM_COMMAND_SUMMARIES)
      .filter(command => !upstream.has(command))
      .sort();
    expect(curatedNotUpstream).toEqual([...DRIVER_LEVEL_CURATED_COMMANDS].sort());
  });

  it('does not list a stale command in the fallback list', () => {
    const upstream = new Set(ALL_COMMANDS);
    expect(COMMANDS_LEFT_TO_FALLBACK.filter(command => !upstream.has(command))).toEqual([]);
  });

  it('does not list a command as both curated and fallback', () => {
    const curated = new Set(Object.keys(APPIUM_COMMAND_SUMMARIES));
    expect(COMMANDS_LEFT_TO_FALLBACK.filter(command => curated.has(command))).toEqual([]);
  });
});

describe(humanizeAppiumCommand, () => {
  it('gives every upstream Appium command a non-empty summary', () => {
    for (const command of ALL_COMMANDS) {
      expect(humanizeAppiumCommand(command)).toBeTruthy();
    }
  });

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

  it.each([
    ['getDeviceInfo', 'Get device info'],
    ['mobileShell', 'Mobile shell'],
    ['getWindowHandles', 'Get window handles'],
    ['some_snake_command', 'Some snake command'],
  ])('humanizes the unmapped command %s by splitting words', (command, expected) => {
    expect(humanizeAppiumCommand(command)).toBe(expected);
  });

  it('returns the original value when it cannot be humanized', () => {
    expect(humanizeAppiumCommand('')).toBe('');
  });
});
