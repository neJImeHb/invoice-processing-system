export const SUGGESTION_CHIPS = [
  "Скільки всього завантажено інвойсів та які їхні статуси?",
  "Яка загальна сума витрат за всіма завершеними рахунками?",
  "Знайди інвойси, де є згадка про послуги розробки або ліцензії.",
  "Повтори обробку для всіх невдалих інвойсів.",
] as const;

interface SuggestionChipsProps {
  readonly disabled: boolean;
  readonly onSend: (message: string) => void;
}

export function SuggestionChips({ disabled, onSend }: SuggestionChipsProps) {
  return (
    <div aria-label="Suggested prompts" className="flex flex-wrap gap-2" role="group">
      {SUGGESTION_CHIPS.map((prompt) => (
        <button
          className="rounded-full border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-800 hover:border-slate-500 disabled:opacity-60"
          disabled={disabled}
          key={prompt}
          type="button"
          onClick={() => {
            onSend(prompt);
          }}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
