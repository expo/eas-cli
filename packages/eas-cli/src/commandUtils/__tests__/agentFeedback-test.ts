import { getAgentTelemetryContext } from '../../analytics/agent';
import { printAgentFeedbackIfNeeded } from '../agentFeedback';
import { isNonInteractiveByDefault } from '../flags';

jest.mock('../../analytics/agent');
jest.mock('../flags');

const getAgentTelemetryContextMock = jest.mocked(getAgentTelemetryContext);
const isNonInteractiveByDefaultMock = jest.mocked(isNonInteractiveByDefault);

beforeEach(() => {
  getAgentTelemetryContextMock.mockReturnValue({ id: 'codex', sessionId: undefined });
  isNonInteractiveByDefaultMock.mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it.each([['--non-interactive'], ['--json']])(
  'prints feedback instructions for agent commands run with %s',
  flag => {
    const stderrWriteSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    printAgentFeedbackIfNeeded('build:list', [flag]);

    expect(stderrWriteSpy).toHaveBeenCalledWith(
      '\nEAS CLI issue? Report it: npx --yes submit-expo-feedback --category eas-cli --subject "build:list" "<what happened and how to reproduce>"\n'
    );
  }
);

it('prints feedback instructions when non-interactive mode is inferred', () => {
  isNonInteractiveByDefaultMock.mockReturnValue(true);
  const stderrWriteSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

  printAgentFeedbackIfNeeded('build', []);

  expect(stderrWriteSpy).toHaveBeenCalledTimes(1);
});

it('does not print feedback instructions in interactive mode', () => {
  const stderrWriteSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

  printAgentFeedbackIfNeeded('build', []);

  expect(stderrWriteSpy).not.toHaveBeenCalled();
});

it('does not print feedback instructions without a detected agent', () => {
  getAgentTelemetryContextMock.mockReturnValue(null);
  const stderrWriteSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

  printAgentFeedbackIfNeeded('build', ['--non-interactive']);

  expect(stderrWriteSpy).not.toHaveBeenCalled();
});
