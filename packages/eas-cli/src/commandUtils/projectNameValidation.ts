import { isSlugForbidden, isValidExperienceName, isValidSlugStrict } from './experienceParser';

/**
 * Perform the same validation as the server, to avoid GraphQL errors.
 */
export function validateFullNameAndSlug(fullName: string, slug: string): void {
  if (!isValidExperienceName(fullName)) {
    throw new Error(`Invalid project name: ${fullName}`);
  }

  if (!isValidSlugStrict(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }

  if (isSlugForbidden(slug)) {
    throw new Error(
      `Cannot create an app named "${slug}" because it would conflict with a dependency of the same name.`
    );
  }

  if (fullName.length > 255) {
    throw new Error(`Project full name (${fullName}) can not be longer than 255 characters.`);
  }
}

/**
 * Attempt to derive a valid slug name from the one passed in
 */
export function validSlugName(slug: string): string {
  const chars = slug.split('');
  const validChars = chars.filter(char => isValidSlugStrict(char));
  return validChars.join('');
}
