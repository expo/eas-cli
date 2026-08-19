import { type UPSTREAM_APPIUM_COMMANDS } from './appiumCommands.generated';

// Human-readable summaries for Appium command names captured via Appium Event
// Timings. The raw command name (e.g. `getWindowRect`) is preserved in each
// event's `data.command`; the summary is what surfaces in the session timeline,
// so it should read like a short past-tense description of what happened.
//
// Keys are Appium command names as they appear in event timings. Every command
// declared by `@appium/base-driver` must have an entry here (enforced at compile
// time by the assertions below, which read the generated
// `appiumCommands.generated.ts` snapshot); a few extra keys are driver-level
// commands (e.g. clipboard) that base-driver does not declare.
export const APPIUM_COMMAND_SUMMARIES = {
  // Session lifecycle
  createSession: 'Started the session',
  deleteSession: 'Ended the session',
  getSession: 'Read the session details',
  getStatus: 'Checked the server status',
  getAppiumSessions: 'Listed Appium sessions',
  getAppiumSessionCapabilities: 'Read the session capabilities',
  getTimeouts: 'Read timeouts',
  timeouts: 'Set timeouts',
  getSettings: 'Read Appium settings',
  updateSettings: 'Updated Appium settings',
  listCommands: 'Listed available commands',
  listExtensions: 'Listed available extensions',
  receiveAsyncResponse: 'Received an async response',

  // Screen and media
  getScreenshot: 'Took a screenshot',
  getElementScreenshot: 'Took a screenshot of an element',
  getPageSource: 'Read the screen contents',
  printPage: 'Printed the page',

  // Window and orientation
  getWindowRect: 'Read the screen size',
  setWindowRect: 'Resized the window',
  maximizeWindow: 'Maximized the window',
  minimizeWindow: 'Minimized the window',
  fullScreenWindow: 'Made the window full screen',
  getWindowHandle: 'Read the current window',
  getWindowHandles: 'Listed open windows',
  setWindow: 'Switched window',
  closeWindow: 'Closed the window',
  createNewWindow: 'Opened a new window',
  setFrame: 'Switched to a frame',
  switchToParentFrame: 'Switched to the parent frame',
  getOrientation: 'Read the screen orientation',
  setOrientation: 'Changed the screen orientation',
  getRotation: 'Read the device rotation',
  setRotation: 'Rotated the device',

  // Device
  getDeviceTime: 'Read the device time',
  getGeoLocation: 'Read the device location',
  setGeoLocation: 'Set the device location',
  getNetworkConnection: 'Read the network connection',
  setNetworkConnection: 'Changed the network connection',
  setDevicePosture: 'Set the device posture',
  clearDevicePosture: 'Cleared the device posture',
  setPermissions: 'Set app permissions',

  // Element discovery
  findElement: 'Found an element',
  findElements: 'Found elements',
  findElementFromElement: 'Found a nested element',
  findElementsFromElement: 'Found nested elements',
  findElementFromShadowRoot: 'Found an element in a shadow root',
  findElementsFromShadowRoot: 'Found elements in a shadow root',
  elementShadowRoot: 'Read an element shadow root',
  active: 'Read the focused element',

  // Element interaction
  click: 'Tapped an element',
  clear: 'Cleared an element',
  setValue: 'Typed into an element',
  getText: 'Read element text',
  getName: 'Read an element tag',
  getAttribute: 'Read an element attribute',
  getProperty: 'Read an element property',
  getCssProperty: 'Read an element style',
  getComputedLabel: 'Read an element label',
  getComputedRole: 'Read an element role',
  getElementRect: 'Read an element position and size',
  elementDisplayed: 'Checked if an element was visible',
  elementEnabled: 'Checked if an element was enabled',
  elementSelected: 'Checked if an element was selected',

  // Gestures
  performActions: 'Performed a gesture',
  releaseActions: 'Finished a gesture',

  // App management
  installApp: 'Installed an app',
  removeApp: 'Removed an app',
  isAppInstalled: 'Checked if an app was installed',
  activateApp: 'Activated an app',
  terminateApp: 'Terminated an app',
  queryAppState: 'Read the app state',
  background: 'Sent the app to the background',

  // Contexts
  getContexts: 'Listed available contexts',
  getCurrentContext: 'Read the current context',
  setContext: 'Switched context',

  // Web navigation
  setUrl: 'Opened a URL',
  getUrl: 'Read the current URL',
  back: 'Navigated back',
  forward: 'Navigated forward',
  refresh: 'Refreshed the page',
  title: 'Read the page title',

  // Cookies
  getCookie: 'Read a cookie',
  getCookies: 'Read all cookies',
  setCookie: 'Set a cookie',
  deleteCookie: 'Deleted a cookie',
  deleteCookies: 'Deleted all cookies',

  // Alerts
  getAlertText: 'Read an alert',
  setAlertText: 'Typed into an alert',
  postAcceptAlert: 'Accepted an alert',
  postDismissAlert: 'Dismissed an alert',

  // Keyboard and input methods
  hideKeyboard: 'Hid the keyboard',
  isKeyboardShown: 'Checked if the keyboard was shown',
  activateIMEEngine: 'Activated an input method',
  deactivateIMEEngine: 'Deactivated the input method',
  getActiveIMEEngine: 'Read the active input method',
  availableIMEEngines: 'Listed input methods',
  isIMEActivated: 'Checked if an input method was active',

  // Clipboard (driver-level, not declared by base-driver)
  getClipboard: 'Read the clipboard',
  setClipboard: 'Wrote to the clipboard',

  // Files
  pushFile: 'Pushed a file to the device',
  pullFile: 'Pulled a file from the device',
  pullFolder: 'Pulled a folder from the device',

  // Logs
  getLog: 'Read device logs',
  getLogTypes: 'Listed log types',
  getLogEvents: 'Read logged events',
  logCustomEvent: 'Logged a custom event',
  generateTestReport: 'Generated a test report',

  // Scripts
  execute: 'Ran a script command',
  executeAsync: 'Ran an async script command',
  executeCdp: 'Ran a Chrome DevTools command',

  // Web authentication (virtual authenticators)
  addVirtualAuthenticator: 'Added a virtual authenticator',
  removeVirtualAuthenticator: 'Removed a virtual authenticator',
  addAuthCredential: 'Added an auth credential',
  getAuthCredential: 'Read auth credentials',
  removeAuthCredential: 'Removed an auth credential',
  removeAllAuthCredentials: 'Removed all auth credentials',
  setUserAuthVerified: 'Set the user verification state',

  // Federated sign-in (FedCM)
  fedCMGetAccounts: 'Listed federated sign-in accounts',
  fedCMSelectAccount: 'Selected a federated sign-in account',
  fedCMGetDialogType: 'Read the federated sign-in dialog type',
  fedCMGetTitle: 'Read the federated sign-in dialog title',
  fedCMClickDialogButton: 'Clicked a federated sign-in dialog button',
  fedCMCancelDialog: 'Canceled the federated sign-in dialog',
  fedCMResetCooldown: 'Reset the federated sign-in cooldown',
  fedCMSetDelayEnabled: 'Toggled the federated sign-in delay',

  // Virtual sensors and pressure sources
  createVirtualSensor: 'Created a virtual sensor',
  updateVirtualSensorReading: 'Updated a virtual sensor reading',
  getVirtualSensorInfo: 'Read virtual sensor info',
  deleteVirtualSensor: 'Removed a virtual sensor',
  createVirtualPressureSource: 'Created a virtual pressure source',
  updateVirtualPressureSource: 'Updated a virtual pressure source',
  deleteVirtualPressureSource: 'Removed a virtual pressure source',

  // Privacy / experimental web platform
  getGlobalPrivacyControl: 'Read the Global Privacy Control setting',
  setGlobalPrivacyControl: 'Set the Global Privacy Control setting',
  setStorageAccess: 'Set storage access',
  setRPHRegistrationMode: 'Set the protocol handler registration mode',
  setSPCTransactionMode: 'Set the payment transaction mode',
} satisfies Record<string, string>;

// Compile-time coverage checks (in place of a runtime test): if either of these
// errors, `tsc` names the offending command(s).
//
// AssertNever<T> only accepts `never`, so a non-empty union of command names
// fails the constraint and surfaces the exact commands in the error.
type AssertNever<T extends never> = T;
type CuratedCommand = keyof typeof APPIUM_COMMAND_SUMMARIES;
type UpstreamCommand = (typeof UPSTREAM_APPIUM_COMMANDS)[number];

// Driver-level commands curated but not declared by base-driver.
type DriverLevelCommand = 'background' | 'getClipboard' | 'setClipboard';

// 1) Every upstream Appium command must have a curated summary.
type _EveryUpstreamCommandIsCurated = AssertNever<Exclude<UpstreamCommand, CuratedCommand>>;

// 2) Every curated command must be a real upstream command (or a known driver-level one).
type _EveryCuratedCommandExistsUpstream = AssertNever<
  Exclude<CuratedCommand, UpstreamCommand | DriverLevelCommand>
>;

/**
 * Translate a raw Appium command name into a short, human-readable summary.
 *
 * If a command has no curated summary, the raw command name is returned
 * unchanged — we intentionally do not guess a phrasing. The compile-time
 * assertions above keep APPIUM_COMMAND_SUMMARIES in sync with the upstream
 * command set so new commands are given a real summary rather than relying on
 * this passthrough.
 */
export function humanizeAppiumCommand(command: string): string {
  return (APPIUM_COMMAND_SUMMARIES as Record<string, string>)[command] ?? command;
}
