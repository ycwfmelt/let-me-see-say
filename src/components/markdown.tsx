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
      className={`prose prose-invert prose-sm max-w-none
        prose-headings:text-gray-200 prose-p:text-gray-300
        prose-a:text-blue-400 prose-strong:text-gray-200
        prose-li:text-gray-300 prose-code:text-blue-300
        prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
        prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700
        ${className ?? ""}`}
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
