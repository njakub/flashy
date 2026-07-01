import { TestSession } from "@/components/TestSession";

interface Props {
  params: Promise<{ deckId: string }>;
}

export default async function TestPage({ params }: Props) {
  const { deckId } = await params;
  return <TestSession deckId={deckId} />;
}
