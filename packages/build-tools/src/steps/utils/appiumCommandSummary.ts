// Human-readable summaries for Appium command names captured via Appium Event
// Timings. The raw command name (e.g. `getWindowRect`) is preserved in each
// event's `data.command`; the summary is what surfaces in the session timeline,
// so it should read like a short past-tense description of what happened.
//
// Keys are Appium command names as they appear in event timings. Most come from
// `@appium/base-driver`'s command set (see the coverage test, which imports the
// upstream list so newly added commands don't slip through uncategorized); a few
// are driver-level commands (e.g. clipboard) that base-driver does not declare.
export const APPIUM_COMMAND_SUMMARIES: Record<string, string> = {
  // Session lifecycle
  createSession: 'Started the session',
  deleteSession: 'Ended the session',
  getSession: 'Read the session details',
  getStatus: 'Checked the server status',

  // Screen and media
  getScreenshot: 'Took a screenshot',
  getElementScreenshot: 'Took a screenshot of an element',
  getPageSource: 'Read the screen contents',
  printPage: 'Printed the page',

  // Window and orientation
  getWindowRect: 'Read the screen size',
  setWindowRect: 'Resized the window',
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

  // Element discovery
  findElement: 'Found an element',
  findElements: 'Found elements',
  findElementFromElement: 'Found a nested element',
  findElementsFromElement: 'Found nested elements',
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

  // Alerts
  getAlertText: 'Read an alert',
  setAlertText: 'Typed into an alert',
  postAcceptAlert: 'Accepted an alert',
  postDismissAlert: 'Dismissed an alert',

  // Keyboard
  hideKeyboard: 'Hid the keyboard',
  isKeyboardShown: 'Checked if the keyboard was shown',

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
  logCustomEvent: 'Logged a custom event',

  // Settings
  getSettings: 'Read Appium settings',
  updateSettings: 'Updated Appium settings',

  // Scripts and timeouts
  execute: 'Ran a script command',
  executeAsync: 'Ran an async script command',
  executeCdp: 'Ran a Chrome DevTools command',
  timeouts: 'Set timeouts',
  getTimeouts: 'Read timeouts',
};

/**
 * Translate a raw Appium command name into a short, human-readable summary.
 *
 * Known commands map to a curated phrase; unknown commands fall back to a
 * best-effort humanization that splits camelCase into words, so a new Appium
 * command still renders as e.g. "Get device info" rather than "getDeviceInfo".
 */
export function humanizeAppiumCommand(command: string): string {
  const known = APPIUM_COMMAND_SUMMARIES[command];
  if (known) {
    return known;
  }
  const words = command
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!words) {
    return command;
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}
