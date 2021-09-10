export default function pick<T extends object, U extends keyof T>(
  object: T,
  keys: U[]
): Pick<T, U> {
  return keys.reduce((obj, key) => {
    if (object && object.hasOwnProperty(key)) {
      obj[key] = object[key];
    }
    return obj;
  }, {} as T);
}
