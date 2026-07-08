import { GenerateCards } from "@/components/GenerateCards";

interface Props {
  params: Promise<{ deckId: string }>;
}

export default async function GenerateCardsPage({ params }: Props) {
  const { deckId } = await params;
  return <GenerateCards deckId={deckId} />;
}
