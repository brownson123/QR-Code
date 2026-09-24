import { Sync } from './sync';

export default async function SyncPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Sync slug={slug} />;
}
