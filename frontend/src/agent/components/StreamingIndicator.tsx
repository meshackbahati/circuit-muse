import React from 'react';

export const StreamingIndicator: React.FC<{ toolName?: string }> = ({ toolName }) => (
  <div className="agent-streaming">
    <div className="agent-streaming-dots">
      <span />
      <span />
      <span />
    </div>
    {toolName && <span className="agent-streaming-tool">Executing {toolName}...</span>}
  </div>
);
