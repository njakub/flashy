import { StudySession } from "@/components/StudySession";

interface Props {
  params: Promise<{ deckId: string }>;
}

export default async function StudyPage({ params }: Props) {
  const { deckId } = await params;
  return <StudySession deckId={deckId} />;
}
