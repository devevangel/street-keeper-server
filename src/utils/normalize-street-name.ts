/**
 * Centralized street name normalizer.
 * Single source of truth for grouping and comparing street names across the codebase.
 *
 * Handles OSM naming variations:
 * - Road classifications: "Park Road (A3066)" -> "park road"
 * - Abbreviations: "High St", "Main Rd" -> "high street", "main road"
 * - Apostrophes: "St George's" -> "st georges"
 * - "The" prefix, directional abbreviations, hyphens, etc.
 */

/**
 * Normalize a street name for grouping and comparison.
 * Use this everywhere street names are used as Map keys or for equality checks.
 */
export function normalizeStreetName(name: string): string {
  if (!name) return "";

  return (
    name
      // Remove road classifications: "(A3)", "(B2154)", "(A288)", etc.
      .replace(/\s*\([A-Z]\d+[A-Za-z]?\d*\)\s*/g, "")
      // Remove "The" prefix
      .replace(/^the\s+/i, "")
      .toLowerCase()
      // Expand common abbreviations
      .replace(/\bst\.\s/gi, "saint ")
      .replace(/\bst\.$/gi, "saint")
      .replace(/\bst\s/gi, "saint ")
      .replace(/\brd\.?\b/gi, "road")
      .replace(/\bave\.?\b/gi, "avenue")
      .replace(/\bln\.?\b/gi, "lane")
      .replace(/\bdr\.?\b/gi, "drive")
      .replace(/\bct\.?\b/gi, "court")
      .replace(/\bblvd\.?\b/gi, "boulevard")
      .replace(/\bhwy\.?\b/gi, "highway")
      .replace(/\bpl\.?\b/gi, "place")
      .replace(/\bsq\.?\b/gi, "square")
      .replace(/(?:^|\s)n\.\s/gi, " north ")
      .replace(/(?:^|\s)n\s/gi, " north ")
      .replace(/(?:^|\s)s\.\s/gi, " south ")
      .replace(/(?:^|\s)s\s/gi, " south ")
      .replace(/\be\.?\s/gi, "east ")
      .replace(/\bw\.?\s/gi, "west ")
      .replace(/[''"`]/g, "")
      .replace(/\./g, "")
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Backwards-compatible alias. */
export const normalizeStreetNameForMatching = normalizeStreetName;

function calculateStreetNameSimilarity(name1: string, name2: string): number {
  if (name1 === name2) return 1.0;
  const words1 = name1.split(" ").filter((w) => w.length > 0);
  const words2 = name2.split(" ").filter((w) => w.length > 0);
  if (words1.length === 0 || words2.length === 0) return 0;
  const matchingWords = words1.filter((w) => words2.includes(w)).length;
  const totalUniqueWords = new Set([...words1, ...words2]).size;
  return matchingWords / totalUniqueWords;
}

/**
 * Check if two street names refer to the same street.
 */
export function streetNamesMatch(
  name1: string,
  name2: string,
  threshold: number = 0.8
): boolean {
  const n1 = normalizeStreetName(name1);
  const n2 = normalizeStreetName(name2);
  if (n1 === n2) return true;
  return calculateStreetNameSimilarity(n1, n2) >= threshold;
}
