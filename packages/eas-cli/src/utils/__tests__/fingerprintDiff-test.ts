import Log from '../../log';
import { abridgedDiff } from '../fingerprintDiff';

jest.mock('chalk', () => ({
  red: jest.fn(text => `red(${text})`),
  green: jest.fn(text => `green(${text})`),
  gray: jest.fn(text => `gray(${text})`),
  cyan: jest.fn(text => `cyan(${text})`),
}));

jest.spyOn(Log, 'log').mockImplementation(jest.fn());

describe('abridgedDiff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should output the diff for added and removed lines with context', () => {
    const str1 = 'Line1\nLine2\nLine3';
    const str2 = 'Line1\nLineX\nLine3';

    abridgedDiff(str1, str2, 1);

    const expectedOutput = [
      'cyan(@@ -2,1 +2,1 @@)',
      ' gray(Line1)',
      'red(-Line2)',
      'green(+LineX)',
      ' gray(Line3)',
    ].join('\n');

    expect(Log.log).toHaveBeenCalledTimes(1);
    expect(Log.log).toHaveBeenCalledWith(expectedOutput);
  });

  it('should output the diff for completely different strings', () => {
    const str1 = 'LineA\nLineB';
    const str2 = 'LineC\nLineD';

    abridgedDiff(str1, str2, 0);

    const expectedOutput = [
      'cyan(@@ -1,2 +1,2 @@)',
      'red(-LineA)',
      'red(-LineB)',
      'green(+LineC)',
      'green(+LineD)',
    ].join('\n');

    expect(Log.log).toHaveBeenCalledTimes(1);
    expect(Log.log).toHaveBeenCalledWith(expectedOutput);
  });

  it('should not include context lines if contextLines is 0', () => {
    const str1 = 'Line1\nLine2\nLine3';
    const str2 = 'Line1\nLineX\nLine3';

    abridgedDiff(str1, str2, 0);

    const expectedOutput = ['cyan(@@ -2,1 +2,1 @@)', 'red(-Line2)', 'green(+LineX)'].join('\n');

    expect(Log.log).toHaveBeenCalledTimes(1);
    expect(Log.log).toHaveBeenCalledWith(expectedOutput);
  });

  it('should handle strings with no differences', () => {
    const str1 = 'SameLine1\nSameLine2';
    const str2 = 'SameLine1\nSameLine2';

    abridgedDiff(str1, str2, 1);

    expect(Log.log).toHaveBeenCalledTimes(1);
    expect(Log.log).toHaveBeenCalledWith('');
  });

  it('should handle empty input strings', () => {
    const str1 = '';
    const str2 = 'NewLine1\nNewLine2';

    abridgedDiff(str1, str2, 1);

    const expectedOutput = ['cyan(@@ -1,0 +1,2 @@)', 'green(+NewLine1)', 'green(+NewLine2)'].join(
      '\n'
    );

    expect(Log.log).toHaveBeenCalledTimes(1);
    expect(Log.log).toHaveBeenCalledWith(expectedOutput);
  });

  it('should handle strings with only removed lines', () => {
    const str1 = 'OldLine1\nOldLine2';
    const str2 = '';

    abridgedDiff(str1, str2, 1);

    const expectedOutput = ['cyan(@@ -1,2 +1,0 @@)', 'red(-OldLine1)', 'red(-OldLine2)'].join('\n');

    expect(Log.log).toHaveBeenCalledTimes(1);
    expect(Log.log).toHaveBeenCalledWith(expectedOutput);
  });

  it('should handle strings with mixed changes and context lines', () => {
    const str1 = 'Header\nLine1\nLine2\nFooter';
    const str2 = 'Header\nLine1\nLineX\nFooter';

    abridgedDiff(str1, str2, 1);

    const expectedOutput = [
      'cyan(@@ -3,1 +3,1 @@)',
      ' gray(Line1)',
      'red(-Line2)',
      'green(+LineX)',
      ' gray(Footer)',
    ].join('\n');

    expect(Log.log).toHaveBeenCalledTimes(1);
    expect(Log.log).toHaveBeenCalledWith(expectedOutput);
  });
});
