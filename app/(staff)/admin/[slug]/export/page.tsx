import { Export } from './export';

export default async function ExportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Export slug={slug} />;
}
