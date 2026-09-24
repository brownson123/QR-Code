import { Checkpoints } from './checkpoints';

export default async function CheckpointsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Checkpoints slug={slug} />;
}
