import { AppleConfigReader } from './config/reader';
import { AppleConfigWriter } from './config/writer';
import { AppleData, PartialAppleData } from './data';

export abstract class AppleTask {
  /** Get a description from the task to use as section headings in the log */
  abstract name(): string;

  /** Prepare the data from the App Store to start syncing with the store configuration */
  abstract prepareAsync(options: TaskPrepareOptions): Promise<void>;

  /** Download all information from the App Store to generate the store configuration */
  abstract downloadAsync(options: TaskDownloadOptions): Promise<void>;

  /** Upload all information from the store configuration to the App Store */
  abstract uploadAsync(options: TaskUploadOptions): Promise<void>;
}

export type TaskPrepareOptions = {
  context: PartialAppleData;
};

export type TaskDownloadOptions = {
  config: AppleConfigWriter;
  context: AppleData;
};

export type TaskUploadOptions = {
  config: AppleConfigReader;
  context: AppleData;
};
