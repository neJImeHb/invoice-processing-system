import { formatUploadDate } from "../format";
import type { AssistantChatEntry, ChatEntry, ErrorChatEntry, UserChatEntry } from "../state/chat";
import { ToolPill } from "./ToolPill";

interface ChatTranscriptProps {
  readonly entries: readonly ChatEntry[];
}

export function ChatTranscript({ entries }: ChatTranscriptProps) {
  return (
    <ol aria-live="polite" className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id}>
          <ChatBubble entry={entry} />
        </li>
      ))}
    </ol>
  );
}

function ChatBubble({ entry }: { readonly entry: ChatEntry }) {
  if (entry.role === "error") {
    return <ErrorBubble entry={entry} />;
  }
  if (entry.role === "user") {
    return <UserBubble entry={entry} />;
  }
  return <AssistantBubble entry={entry} />;
}

function UserBubble({ entry }: { readonly entry: UserChatEntry }) {
  return (
    <article className="ml-auto max-w-3xl rounded-lg bg-slate-900 px-4 py-3 text-sm text-white">
      <p className="whitespace-pre-wrap">{entry.text}</p>
      <time className="mt-2 block text-xs text-slate-300" dateTime={entry.createdAt}>
        {formatUploadDate(entry.createdAt)}
      </time>
    </article>
  );
}

function AssistantBubble({ entry }: { readonly entry: AssistantChatEntry }) {
  return (
    <article className="max-w-3xl rounded-lg bg-white px-4 py-3 text-sm text-slate-900 shadow-sm">
      {entry.text.length > 0 ? <p className="whitespace-pre-wrap">{entry.text}</p> : null}
      {entry.tools.map((tool) => (
        <ToolPill key={tool.id} tool={tool} />
      ))}
      <footer className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
        <time dateTime={entry.createdAt}>{formatUploadDate(entry.createdAt)}</time>
        <CopyControl text={entry.text} />
      </footer>
    </article>
  );
}

function ErrorBubble({ entry }: { readonly entry: ErrorChatEntry }) {
  return (
    <article className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      <p>{entry.text}</p>
      <time className="mt-2 block text-xs text-red-700" dateTime={entry.createdAt}>
        {formatUploadDate(entry.createdAt)}
      </time>
    </article>
  );
}

function CopyControl({ text }: { readonly text: string }) {
  return (
    <button
      className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50"
      type="button"
      onClick={() => {
        copyAssistantText(text);
      }}
    >
      Copy
    </button>
  );
}

function copyAssistantText(text: string): void {
  navigator.clipboard.writeText(text).catch((error: unknown) => {
    console.error(error);
  });
}
