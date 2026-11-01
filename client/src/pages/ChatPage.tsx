import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { ChatTranscript } from "../components/ChatTranscript";
import { SuggestionChips } from "../components/SuggestionChips";
import type { ChatEntry } from "../state/chat";
import { useChatSession } from "../state/useChatSession";

export function ChatPage() {
  const chat = useChatSession();
  return (
    <section aria-busy={chat.busy} aria-label="Assistant" className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-950">Assistant</h1>
      <ChatStage busy={chat.busy} entries={chat.entries} onSend={chat.send} />
      <MessageForm busy={chat.busy} draft={chat.draft} onDraft={chat.setDraft} onSend={chat.send} />
    </section>
  );
}

function ChatStage({
  busy,
  entries,
  onSend,
}: {
  readonly busy: boolean;
  readonly entries: readonly ChatEntry[];
  readonly onSend: (message: string) => void;
}) {
  if (entries.length === 0) {
    return <SuggestionChips disabled={busy} onSend={onSend} />;
  }
  return <ChatTranscript entries={entries} />;
}

function MessageForm({
  busy,
  draft,
  onDraft,
  onSend,
}: {
  readonly busy: boolean;
  readonly draft: string;
  readonly onDraft: Dispatch<SetStateAction<string>>;
  readonly onSend: (message: string) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSend(draft);
  };
  return (
    <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submit}>
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
        Message
        <textarea
          className="min-h-16 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
          disabled={busy}
          onChange={(event) => {
            onDraft(event.target.value);
          }}
          rows={2}
          value={draft}
        />
      </label>
      <button
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        disabled={busy || draft.trim().length === 0}
        type="submit"
      >
        Send
      </button>
    </form>
  );
}
