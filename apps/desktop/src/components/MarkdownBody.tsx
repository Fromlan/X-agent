import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { MouseEvent } from "react";

interface Props {
  content: string;
  streaming?: boolean;
  /** Skip react-markdown (streaming / long-history perf). */
  plain?: boolean;
}

function isHttpUrl(href: string | undefined): href is string {
  if (!href) return false;
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function onMarkdownLinkClick(e: MouseEvent<HTMLAnchorElement>, href?: string) {
  if (!isHttpUrl(href)) return;
  e.preventDefault();
  e.stopPropagation();
  void window.xAgent.openExternalUrl(href);
}

const components: Components = {
  a: ({ href, children, ...rest }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => onMarkdownLinkClick(e, href)}
    >
      {children}
    </a>
  ),
};

export function MarkdownBody({
  content,
  streaming = false,
  plain = false,
}: Props) {
  if (!content && streaming) {
    return <div className="markdown stream-cursor" />;
  }

  if (!content) {
    return null;
  }

  if (plain) {
    return (
      <pre className={streaming ? "markdown-plain stream-cursor" : "markdown-plain"}>
        {content}
      </pre>
    );
  }

  return (
    <div className={streaming ? "markdown stream-cursor" : "markdown"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
