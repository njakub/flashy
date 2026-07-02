import { TestRunDetail } from "@/components/TestRunDetail";

interface Props {
  params: Promise<{ deckId: string; runId: string }>;
}

export default async function HistoryRunPage({ params }: Props) {
  const { deckId, runId } = await params;
  return <TestRunDetail deckId={deckId} runId={runId} />;
}
