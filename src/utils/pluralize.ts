/**
 * Russian pluralization utility
 *
 * Russian has 3 plural forms:
 * - 1, 21, 31... (один трек)
 * - 2-4, 22-24... (два трека)
 * - 0, 5-20, 25-30... (пять треков)
 */

/**
 * Returns the correct plural form for Russian language
 * @param n - The number to pluralize
 * @param forms - Array of 3 forms: [one, few, many]
 * @example pluralize(5, ['трек', 'трека', 'треков']) // 'треков'
 */
export function pluralize(n: number, forms: [string, string, string]): string {
  const absN = Math.abs(n)
  const n100 = absN % 100
  const n10 = absN % 10

  if (n100 > 10 && n100 < 20) {
    return forms[2] // 11-19 -> many
  }
  if (n10 > 1 && n10 < 5) {
    return forms[1] // 2-4 -> few
  }
  if (n10 === 1) {
    return forms[0] // 1 -> one
  }
  return forms[2] // 0, 5-9 -> many
}

/**
 * Common plural forms for the app
 */
export const PLURAL_FORMS = {
  track: ['трек', 'трека', 'треков'] as [string, string, string],
  playlist: ['плейлист', 'плейлиста', 'плейлистов'] as [string, string, string],
  profile: ['профиль', 'профиля', 'профилей'] as [string, string, string],
  minute: ['минута', 'минуты', 'минут'] as [string, string, string],
  hour: ['час', 'часа', 'часов'] as [string, string, string],
}

/**
 * Formats a count with its plural form
 * @example formatCount(5, PLURAL_FORMS.track) // '5 треков'
 */
export function formatCount(n: number, forms: [string, string, string]): string {
  return `${n} ${pluralize(n, forms)}`
}
