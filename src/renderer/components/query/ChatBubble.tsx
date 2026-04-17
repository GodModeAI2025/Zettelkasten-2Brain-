import { MarkdownViewer } from '../wiki/MarkdownViewer';

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  confidence?: string;
  streaming?: boolean;
}

export function ChatBubble({ role, content, confidence, streaming }: ChatBubbleProps) {
  return (
    <div className={`chat-bubble chat-${role}`}>
      <div className="chat-bubble-header">
        <span className="chat-role">{role === 'user' ? 'Du' : '2Brain'}</span>
        {confidence && (
          <span className={`badge ${confidence === 'high' ? 'badge-success' : confidence === 'medium' ? 'badge-warning' : 'badge-error'}`}>
            {confidence}
          </span>
        )}
        {streaming && <span className="chat-streaming-dot" />}
      </div>
      <div className="chat-bubble-content">
        {role === 'assistant' ? (
          <MarkdownViewer content={content} />
        ) : (
          <p>{content}</p>
        )}
      </div>
    </div>
  );
}
