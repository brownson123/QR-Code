import { Staff } from './staff';

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Staff slug={slug} />;
}
