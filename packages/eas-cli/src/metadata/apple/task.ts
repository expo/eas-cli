import { AppleConfigReader } from './config/reader';
import { AppleConfigWriter } from './config/writer';
import { AppleContext, PartialAppleContext } from './context';

export abstract class AppleTask {
  /** Get a description from the task to use as section headings in the log */
  abstract name(): string;

  /** Prepare both the context and the ASC API to interact with the ASC data */
  abstract prepareAsync(options: TaskPrepareOptions): Promise<void>;

  /** Pull all information from the ASC API to store it locally in a schema config file */
  abstract downloadAsync(options: TaskDownloadOptions): Promise<void>;

  /** Perform ASC API calls to upload the data into ASC */
  abstract uploadAsync(options: TaskUploadOptions): Promise<void>;
}

export type TaskPrepareOptions = {
  context: PartialAppleContext;
};

export type TaskDownloadOptions = {
  config: AppleConfigWriter;
  context: AppleContext;
};

export type TaskUploadOptions = {
  config: AppleConfigReader;
  context: AppleContext;
};
