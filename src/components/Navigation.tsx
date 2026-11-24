/**
 * The navy top bar on every app screen (decision D21). TA screens show the
 * user's name; the student link (/r/...) shows their email, so a student can
 * see which account they signed in with (the roster matches on it).
 *
 * Keep the data-testid hooks (`app-navigation`, `nav-sign-in-button`,
 * `nav-user-name`, `nav-user-email`): the tests rely on them.
 */
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthOverlay, signOut, useAuthProfileReady } from 'deepspace'

export default function Navigation() {
  const { isLoaded, isSignedIn, user } = useAuthProfileReady({ requireUser: true })
  const { pathname } = useLocation()
  const [showAuthModal, setShowAuthModal] = useState(false)
  const student = pathname.startsWith('/r/')

  return (
    <header data-testid="app-navigation" className="bg-foreground text-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link to="/rounds" className="text-lg font-extrabold">
          SlotDraft
        </Link>
        <div className="flex-1" />
        {!isLoaded ? null : isSignedIn && user ? (
          <>
            <span data-testid="nav-user-name" className={student ? 'sr-only' : 'max-w-[40vw] truncate text-band-muted'}>
              {user.name || user.email}
            </span>
            <span data-testid="nav-user-email" className={student ? 'min-w-0 truncate text-band-muted' : 'sr-only'}>
              {user.email}
            </span>
            <button
              onClick={() => signOut()}
              className="min-h-11 shrink-0 whitespace-nowrap rounded-lg px-3 font-semibold text-white hover:bg-white/10"
            >
              Sign out
            </button>
          </>
        ) : !isSignedIn ? (
          <button
            data-testid="nav-sign-in-button"
            onClick={() => setShowAuthModal(true)}
            className="min-h-11 rounded-lg bg-white px-4 font-semibold text-foreground hover:bg-band-muted"
          >
            Sign in
          </button>
        ) : null}
      </div>
      {showAuthModal && (
        <AuthOverlay
          title="Sign in to SlotDraft"
          description="No password needed. Use your Google or GitHub account."
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </header>
  )
}
