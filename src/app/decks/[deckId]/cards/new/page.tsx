import { CardForm } from "@/components/CardForm";

interface Props {
  params: Promise<{ deckId: string }>;
}

export default async function NewCardPage({ params }: Props) {
  const { deckId } = await params;
  return <CardForm deckId={deckId} />;
}
