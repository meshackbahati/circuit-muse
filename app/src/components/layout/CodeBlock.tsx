import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeBlockProps {
  children: string;
  language?: string;
}

const codeStyle: React.CSSProperties = {
  margin: '16px 0',
  borderRadius: '8px',
  fontSize: '13px',
  fontFamily: 'var(--mono, monospace)',
};

export const CodeBlock: React.FC<CodeBlockProps> = ({ children, language = 'text' }) => (
  <SyntaxHighlighter
    language={language}
    style={vscDarkPlus}
    customStyle={codeStyle}
    showLineNumbers={language !== 'text' && language !== 'bash'}
    wrapLongLines
  >
    {children.trim()}
  </SyntaxHighlighter>
);
