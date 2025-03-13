import { useState, useRef, useEffect } from 'react';

interface JobApplicationInputProps {
  onSubmit: (resumeData: any, keywords: string[]) => void;
  disabled: boolean;
}

export default function JobApplicationInput({ onSubmit, disabled }: JobApplicationInputProps) {
  const [resumeData, setResumeData] = useState<any>(null);
  const [keywords, setKeywords] = useState<string>('');
  const [resumeFileName, setResumeFileName] = useState<string>('');
  const [isParsingPdf, setIsParsingPdf] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setResumeFileName(file.name);

    // Check if the file is a PDF
    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file');
      setResumeFileName('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setIsParsingPdf(true);

    try {
      // Read the file as text - for PDF we're extracting the text on the backend
      const reader = new FileReader();
      reader.onload = () => {
        // Store the PDF as ArrayBuffer - it will be converted to text by the backend
        const arrayBuffer = reader.result as ArrayBuffer;
        // We'll use the raw binary data which will be converted to text by the backend
        setResumeData({
          isPdf: true,
          fileName: file.name,
          // For display purposes, estimate the size of the resume
          estimatedWords: Math.floor(arrayBuffer.byteLength / 10), // Rough estimate
        });
        setIsParsingPdf(false);
      };

      reader.onerror = () => {
        console.error('Error reading PDF file');
        alert('Error reading PDF file. Please make sure it is a valid PDF document.');
        setResumeFileName('');
        setIsParsingPdf(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      };

      reader.readAsArrayBuffer(file);
    } catch (err) {
      console.error('Error parsing PDF file:', err);
      alert('Error parsing PDF file. Please make sure it is a valid PDF document.');
      setResumeFileName('');
      setIsParsingPdf(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleKeywordsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setKeywords(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resumeData) {
      alert('Please upload your resume first');
      return;
    }

    if (!keywords.trim()) {
      alert('Please enter at least one job keyword');
      return;
    }

    const keywordsList = keywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k !== '');
    onSubmit(resumeData, keywordsList);
  };

  const clearResume = () => {
    setResumeData(null);
    setResumeFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4 border rounded-lg">
      <h2 className="text-lg font-semibold">Job Application Agent</h2>

      <div className="flex flex-col gap-2">
        <label className="font-medium text-gray-700">Upload Resume (PDF only)</label>
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleResumeUpload}
            disabled={disabled || isParsingPdf}
            accept=".pdf"
            className="hidden"
            id="resume-upload"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isParsingPdf}
            className="px-3 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors disabled:opacity-50">
            Choose File
          </button>
          <span className="text-sm text-gray-600 truncate flex-1">{resumeFileName || 'No file chosen'}</span>
          {resumeFileName && !isParsingPdf && (
            <button type="button" onClick={clearResume} disabled={disabled} className="text-red-500 hover:text-red-700">
              ✕
            </button>
          )}
        </div>
        {isParsingPdf && <div className="text-sm text-blue-600">Processing PDF... Please wait.</div>}
        {resumeData && !isParsingPdf && (
          <div className="text-sm text-green-600">
            Resume successfully loaded
            {resumeData.estimatedWords && ` (~${resumeData.estimatedWords} estimated words)`}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="keywords" className="font-medium text-gray-700">
          Job Keywords (comma separated)
        </label>
        <input
          id="keywords"
          type="text"
          value={keywords}
          onChange={handleKeywordsChange}
          disabled={disabled || isParsingPdf}
          placeholder="e.g., Software Engineer, Python, Remote"
          className="w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-gray-100 disabled:text-gray-500"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-medium text-gray-700">Instructions (Optional)</label>
        <textarea
          placeholder="Any specific instructions for the agent..."
          disabled={disabled || isParsingPdf}
          className="w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-gray-100 disabled:text-gray-500"
          rows={2}
        />
      </div>

      <button
        type="submit"
        disabled={disabled || isParsingPdf || !resumeData || !keywords.trim()}
        className="px-4 py-2 bg-[#19C2FF] text-white rounded-md hover:bg-[#0073DC] transition-colors disabled:opacity-50 mt-2">
        {isParsingPdf ? 'Processing PDF...' : 'Start Job Search'}
      </button>
    </form>
  );
}
