export function formatSecondsForLog(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
  }
  if (minutes > 0) {
    parts.push(minutes === 1 ? '1 minute' : `${minutes} minutes`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(seconds === 1 ? '1 second' : `${seconds} seconds`);
  }
  return parts.join(' ');
}
