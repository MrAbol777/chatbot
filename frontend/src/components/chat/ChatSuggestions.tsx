import React from 'react';
import Icon from '../Icon';
import type { SuggestionPrompt } from '../../types/chat.types';

export const DEFAULT_SUGGESTION_PROMPTS: SuggestionPrompt[] = [
  { label: 'یه داستان بساز', prompt: 'یه داستان کوتاه و هیجان‌انگیز برام بساز', icon: 'book' },
  { label: 'کمک در تکلیف', prompt: 'می‌خوام توی تکلیفم کمکم کنی', icon: 'edit' },
  { label: 'یه چیز جالب بگو', prompt: 'یه چیز جالب و عجیب درباره‌ی دنیا بهم بگو', icon: 'sparkles' },
  { label: 'ایده برای پروژه', prompt: 'برای پروژه‌ی مدرسه‌م چند تا ایده‌ی باحال بده', icon: 'lightbulb' }
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
