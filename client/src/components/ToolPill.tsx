import { useState } from "react";
import type { ChatToolCall } from "../state/chat";

interface ToolPillProps {
  readonly tool: ChatToolCall;
}

export function ToolPill({ tool }: ToolPillProps) {
  const [open, setOpen] = useState(true);
  return (
    <article aria-label={tool.name} className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <button
        aria-expanded={open}
        className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-800 shadow-sm"
        type="button"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        {tool.name}
      </button>
      {open ? <ToolDetails tool={tool} /> : null}
    </article>
  );
}

function ToolDetails({ tool }: { readonly tool: ChatToolCall }) {
  return (
    <div className="mt-2 space-y-2">
      <Payload label="Arguments" value={tool.arguments} />
      <Payload label="Result" value={tool.settled ? tool.result : "Running"} />
    </div>
  );
}

function Payload({ label, value }: { readonly label: string; readonly value: unknown }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-slate-800">{formatPayload(value)}</pre>
    </div>
  );
}

function formatPayload(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? "Unreadable value";
  } catch (error) {
    console.error(error);
    return "Unreadable value";
  }
}
