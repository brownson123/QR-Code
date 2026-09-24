import { Participants } from './participants';

export default async function ParticipantsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Participants slug={slug} />;
}
