/**
 * Answer checking for typed spellings.
 *
 * Ported from Swift's `KidsGrading` enum (KidsMode.swift).
 */

/**
 * Trim, lowercase, and drop all whitespace (including internal spaces),
 * so " AB AFT " matches "abaft".
 */
export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

/** An answer counts when it is non-empty and matches the spelling. */
export function isCorrect(answer: string, spelling: string): boolean {
  const a = normalize(answer);
  return a.length > 0 && a === spelling.toLowerCase();
}

/**
 * "abaft" → "A. B. A. F. T." — speech synthesis reads single capital
 * letters as letter names, which is what a bee judge sounds like.
 */
export function spelledAloud(spelling: string): string {
  return spelling.toUpperCase().split('').join('. ') + '.';
}
