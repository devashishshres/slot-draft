/**
 * The small pieces several SlotDraft screens share (decision D21): the navy
 * header band with the 4-step progress, the calendar-page date tab, the seat
 * strip, and the button styles. Everything else stays inline in the pages.
 */
import type { ReactNode } from 'react'
import { dateParts } from '../lib/time'

/** Button looks. Controls are 8px radius and at least 44px tall (§6). */
const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-subtle'
export const button = {
  primary: `${base} bg-primary text-primary-foreground hover:bg-primary/90`,
  success: `${base} bg-success text-success-foreground hover:bg-success/90`,
  preview: `${base} bg-preview text-white hover:bg-preview/90`,
  outline: `${base} border border-input bg-background text-foreground hover:bg-accent`,
  onBand: `${base} border border-band-subtle text-white hover:bg-white/10`,
}

export const STEPS = ['Set up', 'Collect', 'Draft', 'Publish'] as const

/** The navy band under the top bar: title, optional text, and where the round is in its 4 steps. */
export function HeaderBand({ title, step, children }: { title: ReactNode; step?: 1 | 2 | 3 | 4; children?: ReactNode }) {
  return (
    <section className="bg-foreground text-white">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-4 sm:px-6">
        {step && (
          <ol className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Round progress">
            {STEPS.map((label, i) => {
              const n = i + 1
              const state = n < step ? 'done' : n === step ? 'current' : 'next'
              return (
                <li
                  key={label}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={`flex items-center gap-2 ${state === 'next' ? 'text-band-subtle' : state === 'done' ? 'text-band-muted' : 'font-semibold text-white'}`}
                >
                  <span
                    className={`tabular flex h-6 w-6 items-center justify-center rounded-full border text-[13px] ${state === 'current' ? 'border-white bg-white text-foreground' : 'border-current'}`}
                  >
                    {n}
                  </span>
                  {label}
                  {state === 'done' && <span className="sr-only">(done)</span>}
                </li>
              )
            })}
          </ol>
        )}
        <h1 className="text-[28px] font-extrabold leading-tight sm:text-[40px]">{title}</h1>
        {children}
      </div>
    </section>
  )
}

/** A calendar page: month on a blue strip, the day below. `muted` greys it out (a "No" answer). */
export function DateTab({ date, muted = false }: { date: string; muted?: boolean }) {
  const { month, day } = dateParts(date)
  return (
    <span
      className={`inline-flex w-14 shrink-0 flex-col overflow-hidden rounded-md border text-center ${muted ? 'border-input' : 'border-primary'}`}
    >
      <span className={`text-[13px] font-semibold leading-6 text-white ${muted ? 'bg-subtle' : 'bg-primary'}`}>{month}</span>
      <span className={`tabular text-[22px] font-extrabold leading-9 ${muted ? 'text-subtle' : 'text-foreground'}`}>{day}</span>
    </span>
  )
}

/**
 * One square per seat (or per student): filled ones in green. Decorative,
 * so screen readers skip it. The number next to it says the same thing in words.
 */
export function SeatStrip({ filled, total, onBand = false }: { filled: number; total: number; onBand?: boolean }) {
  // ponytail: one square each; a 300-student class makes a long strip that wraps. Switch to a bar if that happens.
  return (
    <span aria-hidden="true" className="inline-flex max-w-md flex-wrap gap-1 align-middle">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-3 w-3 rounded-sm ${i < filled ? (onBand ? 'bg-success-light' : 'bg-success') : onBand ? 'border border-band-subtle' : 'border border-input'}`}
        />
      ))}
    </span>
  )
}

/** A thin navy rule over each section heading (the "3px section rules" in §6). */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t-[3px] border-foreground pt-4">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[22px] font-extrabold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** An error, warning or note box. Always words plus color, never color alone. */
export function Notice({ tone, title, children }: { tone: 'error' | 'attention' | 'success' | 'preview'; title: string; children?: ReactNode }) {
  const tones = {
    error: 'border-destructive bg-destructive-tint text-destructive',
    attention: 'border-attention bg-attention-tint text-attention',
    success: 'border-success bg-success-tint text-success',
    preview: 'border-preview bg-preview-tint text-preview',
  }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border-l-4 px-4 py-3 ${tones[tone]}`}>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-foreground">{children}</div>}
    </div>
  )
}

/** "a, b and c" */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
