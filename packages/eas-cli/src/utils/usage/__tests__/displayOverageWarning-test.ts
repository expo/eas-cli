import chalk from 'chalk';

import Log from '../../../log';
import { PlanType, createProgressBar, displayOverageWarning } from '../displayOverageWarning';

jest.mock('../../../log', () => ({
  ...jest.requireActual('../../../log'),
  warn: jest.fn(),
  newLine: jest.fn(),
  link: jest.fn((url: string, opts?: { text?: string }) => opts?.text ?? url),
}));

describe('createProgressBar', () => {
  it('creates a progress bar with correct fill for a given percentage', () => {
    const bar = createProgressBar(85, 20);
    expect(bar).toContain('85%');
    expect(bar).toMatch(/\[█+░+\] 85%/);
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
  const mockNewLine = Log.newLine as jest.MockedFunction<typeof Log.newLine>;

  beforeEach(() => {
    mockWarn.mockClear();
    mockNewLine.mockClear();
  });

  it('displays a warning for Free plan', () => {
    displayOverageWarning({
      percentUsed: 85,
      printedMetric: 'build credits',
      planType: PlanType.Free,
      name: 'test-account',
    });

    expect(mockWarn).toHaveBeenCalledTimes(3);
    expect(mockWarn).toHaveBeenCalledWith(chalk.bold('Usage Alert:'));
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('85%'));
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('build credits used this month'));
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Upgrade your plan to continue service')
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('https://expo.dev/accounts/test-account/settings/billing')
    );
    expect(mockNewLine).toHaveBeenCalledTimes(1);
  });

  it('displays a warning for Starter plan', () => {
    displayOverageWarning({
      percentUsed: 85,
      printedMetric: 'build credits',
      planType: PlanType.Starter,
      name: 'test-account',
    });

    expect(mockWarn).toHaveBeenCalledTimes(3);
    expect(mockWarn).toHaveBeenCalledWith(chalk.bold('Usage Alert:'));
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Additional usage will be charged at pay-as-you-go rates')
    );
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('See usage in billing'));
    expect(mockNewLine).toHaveBeenCalledTimes(1);
  });

  it('includes correct account name in billing URL', () => {
    displayOverageWarning({
      percentUsed: 85,
      printedMetric: 'build credits',
      planType: PlanType.Free,
      name: 'my-custom-account',
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('https://expo.dev/accounts/my-custom-account/settings/billing')
    );
  });

  it('displays different percentages correctly', () => {
    displayOverageWarning({
      percentUsed: 95,
      printedMetric: 'build credits',
      planType: PlanType.Free,
      name: 'test-account',
    });

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('95%'));
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('build credits used this month'));
  });

  it('displays different metrics correctly', () => {
    displayOverageWarning({
      percentUsed: 90,
      printedMetric: 'updates MAU',
      planType: PlanType.Starter,
      name: 'test-account',
    });

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('90%'));
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('updates MAU used this month'));
  });
});
