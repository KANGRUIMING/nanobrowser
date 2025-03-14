import { useRef } from 'react';
import { HiOutlineDocumentText } from 'react-icons/hi';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

interface PdfUploadProps {
  onFileUpload: (file: File) => void;
  disabled: boolean;
  isUploading: boolean;
  isDarkMode?: boolean;
}

export default function PdfUpload({ onFileUpload, disabled, isUploading, isDarkMode = false }: PdfUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && files[0].type === 'application/pdf') {
      onFileUpload(files[0]);
      // Reset the file input so the same file can be uploaded again if needed
      e.target.value = '';
    }
  };

  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-lg border ${
        isDarkMode ? 'border-slate-700' : 'border-gray-200'
      }`}>
      <button
        type="button"
        onClick={handleFileButtonClick}
        disabled={disabled || isUploading}
        className="flex items-center gap-2 text-sky-400 hover:text-sky-500 disabled:opacity-50 disabled:hover:text-sky-400"
        title={isUploading ? 'Uploading PDF...' : 'Upload PDF'}
        aria-label={isUploading ? 'Uploading PDF...' : 'Upload PDF'}>
        {isUploading ? (
          <AiOutlineLoading3Quarters size={20} className="animate-spin" />
        ) : (
          <HiOutlineDocumentText size={20} />
        )}
        <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          {isUploading ? 'Uploading...' : 'Upload PDF'}
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || isUploading}
      />
    </div>
  );
}
