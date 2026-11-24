/**
 * Gated routes. Any file under src/pages/(app)/(protected)/ requires sign-in:
 * the SDK's <AuthGate> renders the fallback until a session exists.
 *
 * Sign-in with Google/GitHub leaves the site and comes back to /home (see
 * src/server/http-routes.ts). So a signed-out student who opened a round link
 * would lose it. We remember the page here, and (app)/home.tsx sends them back.
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { Outlet } from 'react-router-dom'
import { button } from '@/components/slotdraft'

export const RETURN_KEY = 'slotdraft:returnTo'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel() {
  const [showAuthModal, setShowAuthModal] = useState(false)
  const { pathname, search } = useLocation()
  const student = pathname.startsWith('/r/')
  // A personal invite link (?invite=…) works with any account (R19). The shared
  // link only matches the email on the roster.
  const invited = student && new URLSearchParams(search).has('invite')
  const hint = invited
    ? 'No password needed. Any Google or GitHub account works with your invite link.'
    : student
      ? 'Use the Google or GitHub account with the email your TA has for you.'
      : 'No password needed. Use your Google or GitHub account.'

  useEffect(() => {
    try {
      // The query string too, so ?invite= survives the trip to Google and back.
      sessionStorage.setItem(RETURN_KEY, pathname + search)
    } catch {
      // Storage blocked: the user lands on /rounds after sign-in instead.
    }
  }, [pathname, search])

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-[28px] font-extrabold">{student ? 'Sign in to answer' : 'Sign in to SlotDraft'}</h1>
      <p className="mt-2 text-muted-foreground">{hint}</p>
      <button className={`${button.primary} mt-6 w-full`} onClick={() => setShowAuthModal(true)}>
        Sign in
      </button>
      {showAuthModal && <AuthOverlay title="Sign in to SlotDraft" description={hint} onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}
