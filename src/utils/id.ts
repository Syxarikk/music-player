/**
 * Utility functions for generating unique identifiers
 */

/**
 * Generates a cryptographically secure unique ID
 * Falls back to timestamp + random string for older environments
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for older environments
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}
