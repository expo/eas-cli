export type RawLogLine = {
  logId?: string;
  buildStepId?: string;
  buildStepDisplayName?: string;
  phase?: string;
  time?: string;
  msg?: string;
  result?: string;
  marker?: string;
  err?: any;
};

export type LogLine = Pick<RawLogLine, 'time' | 'result' | 'marker' | 'err'> &
  Required<Pick<RawLogLine, 'msg'>>;

export type StepLogs = {
  key: string;
  label: string;
  result?: string;
  logLines: LogLine[];
};

export type JobLogs = Map<string, StepLogs>;
