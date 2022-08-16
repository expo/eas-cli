/**
 * Remove time precision from a date to avoid potential errors with the App Store.
 *
 * "status": "409",
 * "code": "ENTITY_ERROR.ATTRIBUTE.INVALID",
 * "title": "An attribute value is invalid.",
 * "detail": "The attribute 'earliestReleaseDate' only allows hour precision",
 * "source": {
 *   "pointer": "/data/attributes/earliestReleaseDate"
 * }
 */
export function removeDatePrecision(date: null | undefined | string | number | Date): null | Date {
  if (date) {
    try {
      const result = new Date(date);
      result.setMinutes(0);
      result.setSeconds(0);
      result.setMilliseconds(0);

      if (!isNaN(result.getTime())) {
        return result;
      }
    } catch {}
  }
  return null;
}
