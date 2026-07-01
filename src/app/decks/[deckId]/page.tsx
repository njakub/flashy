import { DeckDetail } from "@/components/DeckDetail";

interface Props {
  params: Promise<{ deckId: string }>;
}

export default async function DeckPage({ params }: Props) {
  const { deckId } = await params;
  return <DeckDetail deckId={deckId} />;
}
