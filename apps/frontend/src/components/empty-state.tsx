import { Sparkles } from "lucide-react";

const EXAMPLE_QUESTIONS = [
  "What are the key themes Robert talks about?",
  "When should a client submit a grievance?",
  "Summarize the most recent session notes.",
  "What standards apply to confidentiality breaches?",
];

export function EmptyState({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Sparkles className="size-6" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold text-foreground">Case Intelligence</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Ask a question about client transcripts or policy documents. Every answer comes with the
          evidence behind it.
        </p>
      </div>
      <div className="grid w-full max-w-lg gap-2 sm:grid-cols-2">
        {EXAMPLE_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onPick(question)}
            className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-sm text-card-foreground transition-colors hover:bg-muted"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}
