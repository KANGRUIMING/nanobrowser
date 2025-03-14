import { useState, useRef, useEffect } from 'react';

interface JobInputProps {
  onJobTitleChange: (text: string) => void;
  disabled?: boolean;
  isDarkMode?: boolean;
  placeholder?: string;
}

export default function JobInput({
  onJobTitleChange,
  disabled = false,
  isDarkMode = false,
  placeholder = 'Enter job title or position...',
}: JobInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;
    setText(newText);
    onJobTitleChange(newText);
  };

  return (
    <div
      className={`overflow-hidden rounded-lg border transition-colors focus-within:border-sky-400 hover:border-sky-400 ${isDarkMode ? 'border-slate-700' : ''}`}>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={handleTextChange}
        disabled={disabled}
        className={`w-full border-none p-3 focus:outline-none ${
          disabled
            ? isDarkMode
              ? 'bg-slate-800 text-gray-400'
              : 'bg-gray-100 text-gray-500'
            : isDarkMode
              ? 'bg-slate-800 text-gray-200'
              : 'bg-white'
        }`}
        placeholder={placeholder}
        aria-label="Job title input"
      />
    </div>
  );
}
