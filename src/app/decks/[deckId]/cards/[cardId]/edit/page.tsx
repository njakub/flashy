import { CardForm } from "@/components/CardForm";

interface Props {
  params: Promise<{ deckId: string; cardId: string }>;
}

export default async function EditCardPage({ params }: Props) {
  const { deckId, cardId } = await params;
  return <CardForm deckId={deckId} cardId={cardId} />;
}
