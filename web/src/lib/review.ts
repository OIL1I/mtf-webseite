import type { Rules } from './types';
import type { CartItem } from './cart.svelte';

/** Schätzt clientseitig, wie viele Termine eine Manager-Freigabe brauchen werden. */
export function estimateReviewCount(items: CartItem[], rules: Rules | null, isManager: boolean): number {
  if (!rules || isManager) return 0;
  const now = Date.now();
  let count = 0;
  for (const it of items) {
    const durationH = (it.end - it.start) / 3_600_000;
    const leadH = (it.start - now) / 3_600_000;
    if (
      rules.reviewAll ||
      (it.seriesKey !== null && rules.reviewSeries) ||
      (rules.reviewDurationEnabled && durationH > rules.reviewDurationOverHours) ||
      (rules.reviewShortNoticeEnabled && leadH < rules.reviewShortNoticeUnderHours)
    ) {
      count++;
    }
  }
  return count;
}
