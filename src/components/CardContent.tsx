"use client";

import { Highlight } from "prism-react-renderer";
import { splitFences } from "@/lib/content/markdown";
import { flashyCodeTheme } from "@/lib/content/prismTheme";

interface Props {
  text: string;
  className?: string;
}

/**
 * Renders card front/back text: prose keeps the plain `whitespace-pre-wrap`
 * behavior every call site already used, fenced code blocks (```lang …```)
 * render with syntax highlighting. Legacy cards with no fences render
 * exactly as before — this is purely additive.
 */
export function CardContent({ text, className }: Props) {
  const segments = splitFences(text);
  return (
    <div className={className}>
      {segments.map((seg, i) =>
        seg.kind === "prose" ? (
          seg.text === "" ? null : (
            <p key={i} className="whitespace-pre-wrap">
              {seg.text}
            </p>
          )
        ) : (
          <Highlight
            key={i}
            theme={flashyCodeTheme}
            code={seg.text}
            language={seg.lang || "text"}
          >
            {({ className: preClassName, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={`${preClassName} overflow-x-auto rounded-control bg-surface-2 border border-line-2 px-4 py-3 my-2 text-[13px] leading-relaxed font-mono`}
                style={style}
              >
                {tokens.map((line, lineIndex) => (
                  <div key={lineIndex} {...getLineProps({ line })}>
                    {line.map((token, tokenIndex) => (
                      <span key={tokenIndex} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        ),
      )}
    </div>
  );
}
