import { AppleConfigReader } from './config/reader';
import { AppleContext, PartialAppleContext } from './context';

export abstract class AppleTask {
  /** Get a description from the task to use as section headings in the log */
  abstract name(): string;

  /** Prepare both the context and the app store connect API to begin uploading metadata */
  abstract preuploadAsync(options: TaskPrepareOptions): Promise<void>;

  /** Perform app store connect API calls to upload the data into ASC */
  abstract uploadAsync(options: TaskUploadOptions): Promise<void>;
}

export type TaskPrepareOptions = {
  config: AppleConfigReader;
  context: PartialAppleContext;
};

export type TaskUploadOptions = {
  config: AppleConfigReader;
  context: AppleContext;
};
