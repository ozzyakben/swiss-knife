import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render a markdown string with GFM (tables, lists, strikethrough), styled via Tailwind typography. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mb-1 prose-headings:mt-3 prose-headings:font-semibold prose-p:my-1.5 prose-li:my-0.5 prose-pre:bg-muted prose-pre:text-foreground prose-table:text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
