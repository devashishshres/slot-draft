/**
 * Landing page: a STATIC page (top level of src/pages/, no DeepSpace
 * providers, no auth call, no WebSocket). It is prerendered to HTML at build,
 * so it stays renderable without a browser. The app itself starts at /rounds.
 */
import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { button } from '../components/slotdraft'
import { seo } from '../seo'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background">
        <header className="bg-foreground text-white">
          <div className="mx-auto max-w-6xl px-4 py-4 text-lg font-extrabold sm:px-6">SlotDraft</div>
          <div className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:px-6">
            <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight">Retire the sign-up sheet on your office door.</h1>
            <p className="mt-4 max-w-2xl text-lg text-band-muted">
              Students tell you when they can come. SlotDraft fits as many of them as possible into your time windows, so
              nobody loses a slot for signing up late.
            </p>
            <Link to="/rounds" className={`${button.outline} mt-8 border-white`}>
              Open SlotDraft
            </Link>
          </div>
        </header>
      </div>
    </>
  )
}
