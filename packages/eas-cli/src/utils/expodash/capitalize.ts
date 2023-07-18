export default function capitalizeFirstLetter(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}
