import { PaperReader } from "@/components/reader/PaperReader";

export default async function PaperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaperReader id={id} />;
}
