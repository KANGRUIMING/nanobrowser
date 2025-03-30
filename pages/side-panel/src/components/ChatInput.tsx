import { useState, useRef, useEffect, useCallback } from 'react';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onStopTask: () => void;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
  initialContent?: string;
  onChange?: (text: string) => void;
  buttonText?: string;
  placeholder?: string;
  hideSendButton?: boolean;
  rows?: number;
}

export default function ChatInput({
  onSendMessage,
  onStopTask,
  disabled,
  showStopButton,
  setContent,
  isDarkMode = false,
  initialContent,
  onChange,
  buttonText = 'Send',
  placeholder = 'Type a message...',
  hideSendButton = false,
  rows = 5,
}: ChatInputProps) {
  const [text, setText] = useState(initialContent || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Handle text changes and resize textarea
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);

    // Resize textarea
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 400)}px`;
    }
  };

  // Expose a method to set content from outside
  useEffect(() => {
    if (setContent) {
      setContent(setText);
    }
  }, [setContent]);

  // Initial resize when component mounts
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 400)}px`;
    }
  }, []);

  // Add effect to update content when initialContent changes
  useEffect(() => {
    if (initialContent !== undefined) {
      setText(initialContent);
    }
  }, [initialContent]);

  // Call onChange when content changes
  useEffect(() => {
    if (onChange) {
      onChange(text);
    }
  }, [text, onChange]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (text.trim()) {
        onSendMessage(text);
        setText('');
      }
    },
    [text, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={`overflow-hidden rounded-lg border transition-colors focus-within:border-purple-400 hover:border-purple-400 ${isDarkMode ? 'border-slate-700' : ''}`}
      aria-label="Chat input form">
      <div className="flex flex-col">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={rows}
          style={{ minHeight: hideSendButton ? '400px' : 'auto' }}
          className={`w-full resize-none border-none p-2 focus:outline-none ${
            disabled
              ? isDarkMode
                ? 'bg-slate-800 text-gray-400'
                : 'bg-gray-100 text-gray-500'
              : isDarkMode
                ? 'bg-slate-800 text-gray-200'
                : 'bg-white'
          }`}
          placeholder={placeholder}
          aria-label="Message input"
        />

        {!hideSendButton && (
          <div
            className={`flex items-center justify-between px-2 py-1.5 ${
              disabled ? (isDarkMode ? 'bg-slate-800' : 'bg-gray-100') : isDarkMode ? 'bg-slate-800' : 'bg-white'
            }`}>
            <div className="flex gap-2 text-gray-500">{/* Icons can go here */}</div>

            {showStopButton ? (
              <button
                type="button"
                onClick={onStopTask}
                className="rounded-md bg-red-500 px-3 py-1 text-white transition-colors hover:bg-red-600">
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={disabled}
                className={`rounded-md bg-purple-500 px-3 py-1 text-white transition-colors hover:bg-purple-600 ${disabled ? 'opacity-50' : ''}`}>
                {buttonText}
              </button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
