import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { memo, type MouseEvent } from "react";

interface Props {
  content: string;
  streaming?: boolean;
  /** Skip react-markdown (legacy / special-case perf). */
  plain?: boolean;
  /**
   * 关闭 Markdown 解析（性能优化路径）。
   * true → 走 react-markdown；false → 走 plain `<pre>` 零解析。
   * 流式期间建议设为 false，assistant 完成后切 true 一次解析定型。
   */
  useMarkdown?: boolean;
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

export const MarkdownBody = memo(function MarkdownBody({
  content,
  streaming = false,
  plain = false,
  useMarkdown = true,
}: Props) {
  if (!content && streaming) {
    return <div className="markdown stream-cursor" />;
  }

  if (!content) {
    return null;
  }

  // 性能路径：流式期间走 plain，避免每次 text_delta 重跑 react-markdown。
  if (plain || !useMarkdown) {
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
});
