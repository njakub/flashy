"use client";

import { FLAGGED_LABEL } from "@/lib/constants";

interface Props {
  labels: string[];
  selected: string[];
  onToggle: (label: string) => void;
}

/** Multi-select label chip row — used to filter Study/Test card pools. */
export function LabelChips({ labels, selected, onToggle }: Props) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => {
        const isSelected = selected.includes(label);
        const isFlag = label === FLAGGED_LABEL;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onToggle(label)}
            className={`text-micro rounded-chip border px-2.5 py-1 transition-colors ${
              isSelected
                ? isFlag
                  ? "bg-incorrect text-on-semantic border-incorrect"
                  : "bg-accent text-on-accent border-accent"
                : "bg-surface-2 border-line-2 text-ink-2 hover:bg-surface-3"
            }`}
          >
            {isFlag ? "⚑ " : ""}
            {label}
          </button>
        );
      })}
    </div>
  );
}
