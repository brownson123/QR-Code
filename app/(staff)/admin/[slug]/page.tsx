import { Dashboard } from './dashboard';

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Dashboard slug={slug} />;
}
