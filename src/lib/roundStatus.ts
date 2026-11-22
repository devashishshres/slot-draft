import { isOpen } from './rounds'
import { formatShortWhen, formatWhen, tzAbbr } from './time'
import type { Round } from '../schemas/slotdraft'

/** Which of the 4 steps a round is on (the header band progress). */
export function roundStep(round: Round, now: Date): 2 | 3 | 4 {
  if (round.status === 'published') return 4
  return isOpen(round, now) ? 2 : 3
}

/** One line for the rounds list. */
export function roundStatusText(round: Round, now: Date): string {
  const tz = round.timezone
  if (round.status === 'published') return `Published ${formatShortWhen(round.publishedAt, tz)} ${tzAbbr(tz)}`
  if (isOpen(round, now)) return `Collecting responses until ${formatWhen(round.deadline, tz)} ${tzAbbr(tz, new Date(round.deadline))}`
  if (round.draftAt) return 'Draft ready to review'
  return 'Responses closed. Build the draft.'
}
