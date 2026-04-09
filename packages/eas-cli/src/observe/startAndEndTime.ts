export const DEFAULT_DAYS_BACK = 60;

export function startAndEndTime({
  daysFromNow,
  start,
  end,
}: {
  daysFromNow?: number;
  start?: string;
  end?: string;
}) {
  let startTime: string;
  let endTime: string;

  if (daysFromNow) {
    endTime = new Date().toISOString();
    startTime = new Date(Date.now() - daysFromNow * 24 * 60 * 60 * 1000).toISOString();
  } else {
    endTime = end ?? new Date().toISOString();
    startTime =
      start ?? new Date(Date.now() - DEFAULT_DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
  }
  return { startTime, endTime };
}
