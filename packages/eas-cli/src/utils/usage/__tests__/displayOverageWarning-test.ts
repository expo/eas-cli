import chalk from 'chalk';

import { EasService } from '../../../graphql/generated';
import Log from '../../../log';
import { OverageThreshold } from '../calculateOverages';
import {
  PlanType,
  createProgressBar,
  displayOverageWarning,
  displayOverageWarningWithProgressBar,
} from '../displayOverageWarning';

jest.mock('../../../log', () => ({
  ...jest.requireActual('../../../log'),
  warn: jest.fn(),
  newLine: jest.fn(),
  link: jest.fn((url: string, opts?: { text?: string }) => opts?.text ?? url),
}));

describe('createProgressBar', () => {
  it('creates a progress bar with correct fill for 85%', () => {
    const bar = createProgressBar(85, 20);
    expect(bar).toContain('85%');
    expect(bar).toMatch(/\[█+░+\] 85%/);
  });

  it('creates a progress bar with correct fill for 50%', () => {
    const bar = createProgressBar(50, 20);
    expect(bar).toContain('50%');
    expect(bar).toMatch(/\[█+░+\] 50%/);
  });

  it('creates a progress bar with correct fill for 100%', () => {
    const bar = createProgressBar(100, 20);
    expect(bar).toBe('[████████████████████] 100%');
  });

  it('creates a progress bar with correct fill for 0%', () => {
    const bar = createProgressBar(0, 20);
    expect(bar).toBe('[░░░░░░░░░░░░░░░░░░░░] 0%');
  });

  it('handles custom width', () => {
    const bar = createProgressBar(50, 10);
    expect(bar).toContain('50%');
    expect(bar.length).toBeGreaterThan(10); // at least width + brackets + percentage
  });
});

describe('displayOverageWarning', () => {
  const mockWarn = Log.warn as jest.MockedFunction<typeof Log.warn>;
  const threshold: OverageThreshold = {
    service: EasService.Builds,
    printedMetric: 'included build credits',
    percentUsed: 85,
  };

  beforeEach(() => {
    mockWarn.mockClear();
  });

  it('displays warning for Free plan', () => {
    displayOverageWarning(threshold, PlanType.Free, 'test-account');

    expect(mockWarn).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledWith(
      chalk.bold("You've used 85% of your included build credits this month.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Upgrade your plan to continue service')
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('https://expo.dev/accounts/test-account/settings/billing')
    );
  });

  it('displays warning for Starter plan', () => {
    displayOverageWarning(threshold, PlanType.Starter, 'test-account');

    expect(mockWarn).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledWith(
      chalk.bold("You've used 85% of your included build credits this month.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Additional usage will be charged at pay-as-you-go rates')
    );
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('See usage in billing'));
  });

  it('includes correct account name in billing URL', () => {
    displayOverageWarning(threshold, PlanType.Free, 'my-custom-account');

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('https://expo.dev/accounts/my-custom-account/settings/billing')
    );
  });

  it('displays different percentages correctly', () => {
    const threshold95: OverageThreshold = {
      service: EasService.Builds,
      printedMetric: 'included build credits',
      percentUsed: 95,
    };
    displayOverageWarning(threshold95, PlanType.Free, 'test-account');

    expect(mockWarn).toHaveBeenCalledWith(
      chalk.bold("You've used 95% of your included build credits this month.")
    );
  });

  it('displays different metrics correctly', () => {
    const updatesThreshold: OverageThreshold = {
      service: EasService.Updates,
      printedMetric: 'included updates MAU',
      percentUsed: 90,
    };
    displayOverageWarning(updatesThreshold, PlanType.Starter, 'test-account');

    expect(mockWarn).toHaveBeenCalledWith(
      chalk.bold("You've used 90% of your included updates MAU this month.")
    );
  });
});

describe('displayOverageWarningWithProgressBar', () => {
  const mockWarn = Log.warn as jest.MockedFunction<typeof Log.warn>;
  const mockNewLine = Log.newLine as jest.MockedFunction<typeof Log.newLine>;
  const threshold: OverageThreshold = {
    service: EasService.Builds,
    printedMetric: 'included build credits',
    percentUsed: 85,
  };

  beforeEach(() => {
    mockWarn.mockClear();
    mockNewLine.mockClear();
  });

  it('displays warning with progress bar for Free plan', () => {
    displayOverageWarningWithProgressBar(threshold, PlanType.Free, 'test-account');

    expect(mockWarn).toHaveBeenCalledTimes(3);
    expect(mockWarn).toHaveBeenCalledWith(chalk.bold('Usage Alert:'));
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('85%'));
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('included build credits used this month')
    );
    expect(mockNewLine).toHaveBeenCalledTimes(1);
  });

  it('displays warning with progress bar for Starter plan', () => {
    displayOverageWarningWithProgressBar(threshold, PlanType.Starter, 'test-account');

    expect(mockWarn).toHaveBeenCalledTimes(3);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Additional usage will be charged at pay-as-you-go rates')
    );
  });
});
