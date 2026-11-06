/**
 * Markdown of agent answers: GitHub-flavoured (tables, task lists, strikethrough), code blocks highlighted
 * with highlight.js and a copy button. No raw HTML is rendered: react-markdown drops it by default.
 */
import hljs from 'highlight.js/lib/common';
import { type ComponentPropsWithoutRef, memo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { messages } from '@/i18n/messages.es';
import { Button } from './button';
import { Check, Copy } from './icon';
import { cn, mono } from './interaction';

function highlight(code: string, language: string | null): string | null {
  if (!language || !hljs.getLanguage(language)) return null;
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

export function CodeBlock({ code, language }: { code: string; language: string | null }) {
  const [copied, setCopied] = useState(false);
  const html = highlight(code, language);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="relative my-3 overflow-hidden rounded-lg border border-divider bg-canvas">
      <div className="flex h-8 items-center justify-between border-b border-divider bg-surface ps-3 pe-1">
        <span className={cn(mono, 'text-xs text-fg-muted')}>{language ?? messages.chat.code}</span>
        <Button
          size="sm"
          variant="ghost"
          icon={copied ? Check : Copy}
          aria-label={copied ? messages.chat.copied : messages.chat.copy}
          onClick={copy}
        >
          {copied ? messages.chat.copied : messages.chat.copy}
        </Button>
      </div>
      <pre className={cn(mono, 'overflow-x-auto overscroll-x-contain p-3 text-[12.5px] leading-relaxed')}>
        {html === null ? (
          <code>{code}</code>
        ) : (
          // highlight.js escapes the source and only adds <span class="hljs-…"> around tokens.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped highlight.js output, no user HTML
          <code dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) => {
    const language = /language-([\w+#-]+)/.exec(className ?? '')?.[1]?.toLowerCase() ?? null;
    const text = String(children ?? '');
    // Fenced blocks end with a newline (or carry a language); inline code does not.
    if (language || text.includes('\n')) return <CodeBlock code={text.replace(/\n$/, '')} language={language} />;
    return <code {...props}>{children}</code>;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('md', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
