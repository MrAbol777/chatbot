import React from 'react';
import Icon from '../Icon';
import type { SuggestionPrompt } from '../../types/chat.types';

export const DEFAULT_SUGGESTION_PROMPTS: SuggestionPrompt[] = [
  { label: 'به من در تحقیق یک ایده کمک کن', prompt: 'به من در تحقیق یک ایده کمک کن', icon: 'edit' },
  { label: 'خلاصه این مقاله را بنویس', prompt: 'خلاصه این مقاله را بنویس', icon: 'file-text' },
  { label: 'ایده‌هایی برای محتوا بده', prompt: 'ایده‌هایی برای محتوا بده', icon: 'lightbulb' }
];

export interface ChatSuggestionsProps {
  suggestions?: SuggestionPrompt[];
  onSelectSuggestion: (prompt: string) => void;
  disabled?: boolean;
}

export const ChatSuggestions: React.FC<ChatSuggestionsProps> = ({
  suggestions = DEFAULT_SUGGESTION_PROMPTS,
  onSelectSuggestion,
  disabled = false
}) => {
  return (
    <div className="chat-empty-suggestions" role="group" aria-label="پیشنهادهای گفتگو">
      {suggestions.map((item, idx) => (
        <button
          key={`${item.prompt}-${idx}`}
          type="button"
          className="chat-suggestion-chip"
          onClick={() => onSelectSuggestion(item.prompt)}
          disabled={disabled}
        >
          <Icon name={item.icon} size="1.1em" aria-hidden="true" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};

export default ChatSuggestions;
