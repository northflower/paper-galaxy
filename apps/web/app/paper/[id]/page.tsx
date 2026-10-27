import { PaperReader } from "@/components/reader/PaperReader";

export default async function PaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { id } = await params;
  const { focus } = await searchParams;
  return <PaperReader id={id} focusRef={focus} />;
}
