import React, { useMemo } from 'react';
import { marked } from 'marked';

interface Props {
  content: string;
}

export default function ContentViewer({ content }: Props) {
  const html = useMemo(() => {
    try {
      return marked.parse(content, { breaks: true, gfm: true }) as string;
    } catch {
      return `<pre>${escapeHtml(content)}</pre>`;
    }
  }, [content]);

  return (
    <div className="content-viewer">
      <div
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
