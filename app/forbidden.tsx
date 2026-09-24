import Link from 'next/link';

// Rendered with HTTP 403 when a page calls forbidden() (e.g. a volunteer opening /admin).
export default function Forbidden() {
  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: '32px 16px' }}>
      <h1>✕ Organizer access only</h1>
      <p>You’re signed in, but you aren’t an organizer of this event. Ask an organizer to invite you.</p>
      <Link href="/">Home</Link>
    </main>
  );
}
