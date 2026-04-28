"use client";

import ReactMarkdown from "react-markdown";

export function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      className={`prose prose-sm max-w-none
        prose-headings:text-ctp-subtext1 prose-p:text-ctp-subtext1
        prose-a:text-ctp-blue prose-strong:text-ctp-subtext1
        prose-li:text-ctp-subtext1 prose-code:text-ctp-blue
        prose-code:bg-ctp-crust prose-code:px-1 prose-code:py-0.5 prose-code:rounded
        prose-pre:bg-ctp-mantle prose-pre:border prose-pre:border-ctp-surface1
        ${className ?? ""}`}
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
