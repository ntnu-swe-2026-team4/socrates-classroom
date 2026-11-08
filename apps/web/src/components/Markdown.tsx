import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ node: _n, ...props }) => (
          <h2 className="mt-5 mb-2 font-serif text-[15px] font-semibold text-ink first:mt-0" {...props} />
        ),
        h3: ({ node: _n, ...props }) => <h3 className="mt-4 mb-2 text-[14px] font-semibold text-ink" {...props} />,
        p: ({ node: _n, ...props }) => <p className="my-2.5 text-[13.5px] leading-[1.9] text-ink-soft" {...props} />,
        ul: ({ node: _n, ...props }) => (
          <ul className="my-2.5 list-disc space-y-1 pl-5 text-[13.5px] leading-[1.85] text-ink-soft" {...props} />
        ),
        ol: ({ node: _n, ...props }) => (
          <ol className="my-2.5 list-decimal space-y-1 pl-5 text-[13.5px] leading-[1.85] text-ink-soft" {...props} />
        ),
        strong: ({ node: _n, ...props }) => <strong className="font-semibold text-ink" {...props} />,
        a: ({ node: _n, ...props }) => (
          <a
            className="text-ember underline decoration-ember/40 underline-offset-2"
            target="_blank"
            rel="noreferrer"
            {...props}
          />
        ),
        blockquote: ({ node: _n, ...props }) => (
          <blockquote
            className="my-2.5 rounded-r-lg border-l-2 border-ember/60 bg-ember-wash/50 py-1 pr-2 pl-3 text-[13px] leading-[1.85] text-ink"
            {...props}
          />
        ),
        em: ({ node: _n, ...props }) => <em className="text-ink-faint not-italic" {...props} />,
        hr: () => <hr className="my-3 border-line" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
