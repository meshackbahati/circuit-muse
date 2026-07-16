import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../types';
import { ToolCallDisplay } from './ToolCallDisplay';

interface MessageBubbleProps {
  message: Message;
  toolResults?: Record<string, string>;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, toolResults = {} }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isTool = message.role === 'tool';

  if (isSystem || isTool) return null;

  return (
    <div className={`agent-message agent-message-${message.role}`}>
      <div className="agent-message-role">
        {isUser ? 'You' : 'CircuitMuse'}
      </div>
      <div className="agent-message-content">
        {message.content && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const codeStr = String(children).replace(/\n$/, '');
                if (match) {
                  return (
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match[1]}
                      PreTag="div"
                    >
                      {codeStr}
                    </SyntaxHighlighter>
                  );
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
        {message.toolCalls?.map((tc) => (
          <ToolCallDisplay
            key={tc.id}
            toolCall={tc}
            result={toolResults[tc.id]}
          />
        ))}
      </div>
    </div>
  );
};
