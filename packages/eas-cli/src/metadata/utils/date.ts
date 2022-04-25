/**
 * Remove extra precision, otherwise an error will be thrown:
 *
 * "status": "409",
 * "code": "ENTITY_ERROR.ATTRIBUTE.INVALID",
 * "title": "An attribute value is invalid.",
 * "detail": "The attribute 'earliestReleaseDate' only allows hour precision",
 * "source": {
 *   "pointer": "/data/attributes/earliestReleaseDate"
 * }
 */
export function removeDatePrecision(date: any): null | Date {
  if (date) {
    try {
      const result = new Date(date);
      result.setMinutes(0);
      result.setSeconds(0);
      result.setMilliseconds(0);
      return result;
    } catch {}
  }
  return null;
}
