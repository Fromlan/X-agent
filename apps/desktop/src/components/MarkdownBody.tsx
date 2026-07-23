import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface Props {
  content: string;
  streaming?: boolean;
}

const components: Components = {
  a: ({ href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noreferrer" {...rest}>
      {children}
    </a>
  ),
};

export function MarkdownBody({ content, streaming = false }: Props) {
  if (!content && streaming) {
    return <div className="markdown stream-cursor" />;
  }

  if (!content) {
    return null;
  }

  return (
    <div className={streaming ? "markdown stream-cursor" : "markdown"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
