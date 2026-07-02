import { TestHistory } from "@/components/TestHistory";

interface Props {
  params: Promise<{ deckId: string }>;
}

export default async function HistoryPage({ params }: Props) {
  const { deckId } = await params;
  return <TestHistory deckId={deckId} />;
}
