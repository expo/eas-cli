import Log from '../../log';
import { UploadProgress } from '../../uploads';
import { createUploadProgressReporter } from '../uploadProgressReporter';

const MB = 1024 * 1024;

function makeProgress(file: string, uploadedBytes: number, elapsedMs: number): UploadProgress {
  return { file, fileSize: 7 * MB, uploadedBytes, elapsedMs };
}

describe(createUploadProgressReporter, () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('interactive', () => {
    it('shows a line for each active upload once it has run for 10 seconds', () => {
      const onActiveUploadsChanged = jest.fn();
      const report = createUploadProgressReporter({ isInteractive: true, onActiveUploadsChanged });

      report(makeProgress('/dist/ios.hbc', MB, 5_000));
      expect(onActiveUploadsChanged).toHaveBeenLastCalledWith([]);

      report(makeProgress('/dist/ios.hbc', MB, 20_000));
      report(makeProgress('/dist/android.hbc', 6 * MB, 10_000));

      expect(onActiveUploadsChanged).toHaveBeenLastCalledWith([
        'ios.hbc: 1.0 MB of 7.0 MB, 51.2 KB/s, about 2 minutes left',
        'android.hbc: 6.0 MB of 7.0 MB, 614 KB/s',
      ]);
    });

    it('removes an upload once all of its bytes are sent', () => {
      const onActiveUploadsChanged = jest.fn();
      const report = createUploadProgressReporter({ isInteractive: true, onActiveUploadsChanged });

      report(makeProgress('/dist/ios.hbc', MB, 20_000));
      report(makeProgress('/dist/ios.hbc', 7 * MB, 30_000));

      expect(onActiveUploadsChanged).toHaveBeenLastCalledWith([]);
    });

    it('shows at most 5 uploads', () => {
      const onActiveUploadsChanged = jest.fn();
      const report = createUploadProgressReporter({ isInteractive: true, onActiveUploadsChanged });

      for (let i = 0; i < 7; i++) {
        report(makeProgress(`/dist/asset-${i}.png`, MB, 20_000));
      }

      const lines = onActiveUploadsChanged.mock.calls.at(-1)?.[0];
      expect(lines).toHaveLength(6);
      expect(lines[5]).toBe('and 2 more uploads');
    });

    it('does not log', () => {
      const warnSpy = jest.spyOn(Log, 'warn').mockImplementation(() => {});
      const logSpy = jest.spyOn(Log, 'log').mockImplementation(() => {});
      const report = createUploadProgressReporter({
        isInteractive: true,
        onActiveUploadsChanged: () => {},
      });

      report(makeProgress('/dist/ios.hbc', MB, 20_000));

      expect(warnSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('non-interactive', () => {
    it('warns when an upload is slow and then logs its progress every minute', () => {
      let now = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const warnSpy = jest.spyOn(Log, 'warn').mockImplementation(() => {});
      const logSpy = jest.spyOn(Log, 'log').mockImplementation(() => {});
      const report = createUploadProgressReporter({
        isInteractive: false,
        onActiveUploadsChanged: () => {},
      });

      report(makeProgress('/dist/ios.hbc', MB, 20_000));
      now = 30_000;
      report(makeProgress('/dist/ios.hbc', 2 * MB, 50_000));
      now = 60_000;
      report(makeProgress('/dist/ios.hbc', 3 * MB, 80_000));

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'Uploading ios.hbc (7.0 MB) is slow (51.2 KB/s). It may take about 2 minutes.'
      );
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        'Still uploading ios.hbc: 3.0 MB of 7.0 MB, 38.4 KB/s, about 2 minutes left.'
      );
    });

    it('warns again when a retried upload is still slow', () => {
      const warnSpy = jest.spyOn(Log, 'warn').mockImplementation(() => {});
      const report = createUploadProgressReporter({
        isInteractive: false,
        onActiveUploadsChanged: () => {},
      });

      report(makeProgress('/dist/ios.hbc', MB, 20_000));
      report(makeProgress('/dist/ios.hbc', 0, 0));
      report(makeProgress('/dist/ios.hbc', MB, 20_000));

      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('does not log when an upload is fast', () => {
      const warnSpy = jest.spyOn(Log, 'warn').mockImplementation(() => {});
      const logSpy = jest.spyOn(Log, 'log').mockImplementation(() => {});
      const report = createUploadProgressReporter({
        isInteractive: false,
        onActiveUploadsChanged: () => {},
      });

      report(makeProgress('/dist/ios.hbc', 6 * MB, 10_000));

      expect(warnSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
