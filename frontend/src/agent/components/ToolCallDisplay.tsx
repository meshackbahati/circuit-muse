import React, { useState } from 'react';
import type { ToolCall } from '../types';

interface ToolCallDisplayProps {
  toolCall: ToolCall;
  result?: string;
}

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({ toolCall, result }) => {
  const [expanded, setExpanded] = useState(false);
  const { name, arguments: argsStr } = toolCall.function;

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsStr);
  } catch { /* ignore */ }

  let resultObj: { success?: boolean; error?: string } = {};
  if (result) {
    try {
      resultObj = JSON.parse(result);
    } catch { /* ignore */ }
  }

  const isError = resultObj.error || (resultObj.success === false);
  const isSuccess = resultObj.success === true;

  return (
    <div className={`agent-tool-call ${isError ? 'agent-tool-error' : isSuccess ? 'agent-tool-success' : ''}`}>
      <button
        className="agent-tool-header"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="agent-tool-icon">{isError ? '!' : isSuccess ? '\u2713' : '\u25B6'}</span>
        <span className="agent-tool-name">{name}</span>
        <span className="agent-tool-chevron">{expanded ? '\u25BC' : '\u25B6'}</span>
      </button>
      {expanded && (
        <div className="agent-tool-details">
          <div className="agent-tool-args">
            <span className="agent-tool-label">Arguments</span>
            <pre>{JSON.stringify(args, null, 2)}</pre>
          </div>
          {result && (
            <div className="agent-tool-result">
              <span className="agent-tool-label">Result</span>
              <pre>{result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
