/**
 * Where Google/GitHub sign-in lands (src/server/http-routes.ts redirects to /home).
 * Sends the user back to the page they were on before signing in, or to /rounds.
 */
import { Navigate } from 'react-router-dom'
import { RETURN_KEY } from './(protected)/_layout'

function returnPath(): string {
  try {
    const path = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    // Only same-site paths: "/r/abc" yes, "//evil.com" no.
    if (path && path.startsWith('/') && !path.startsWith('//')) return path
  } catch {
    // Storage blocked: fall through.
  }
  return '/rounds'
}

export default function Home() {
  return <Navigate to={returnPath()} replace />
}
