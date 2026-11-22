import { Link } from 'react-router-dom'
import { button } from '../components/slotdraft'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <title>Not found | SlotDraft</title>
      <meta name="robots" content="noindex" />
      <h1 className="text-[28px] font-extrabold">This page doesn’t exist</h1>
      <p className="mt-2 text-muted-foreground">Check the link, or go to your rounds.</p>
      <Link to="/rounds" className={`${button.primary} mt-6`}>
        Go to your rounds
      </Link>
    </div>
  )
}
