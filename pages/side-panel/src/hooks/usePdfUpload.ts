/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback } from 'react';
import { Actors, chatHistoryStore } from '@extension/storage';

type SendMessageFn = (message: any) => void;
type AppendMessageFn = (message: any, sessionId?: string | null) => void;

interface UsePdfUploadOptions {
  isFollowUpMode: boolean;
  isHistoricalSession: boolean;
  sessionIdRef: React.MutableRefObject<string | null>;
  setupConnection: () => void;
  sendMessage: SendMessageFn;
  appendMessage: AppendMessageFn;
  portRef: React.MutableRefObject<chrome.runtime.Port | null>;
  setInputEnabled: (enabled: boolean) => void;
  setShowStopButton: (show: boolean) => void;
  setCurrentSessionId: (sessionId: string | null) => void;
}

interface UsePdfUploadResult {
  uploadingPdf: boolean;
  handlePdfUpload: (fileOrPath: File | string) => Promise<void>;
}

export const usePdfUpload = ({
  isFollowUpMode,
  isHistoricalSession,
  sessionIdRef,
  setupConnection,
  sendMessage,
  appendMessage,
  portRef,
  setInputEnabled,
  setShowStopButton,
  setCurrentSessionId,
}: UsePdfUploadOptions): UsePdfUploadResult => {
  const [uploadingPdf, setUploadingPdf] = useState(false);

  const readFileAsBase64 = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64Content = reader.result?.toString().split(',')[1];
        if (base64Content) {
          resolve(base64Content);
        } else {
          reject(new Error('Failed to read file as base64'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const handlePdfUpload = useCallback(
    async (fileOrPath: File | string) => {
      try {
        if (isHistoricalSession) {
          console.log('Cannot upload files in historical sessions');
          return;
        }

        setUploadingPdf(true);

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) {
          throw new Error('No active tab found');
        }

        // Setup connection if not exists
        if (!portRef.current) {
          setupConnection();
        }

        let file: File;
        let fileName: string;

        if (typeof fileOrPath === 'string') {
          try {
            console.log('Processing PDF from file path:', fileOrPath);
            const response = await fetch(`file://${fileOrPath}`);
            const blob = await response.blob();
            fileName = fileOrPath.split(/[\\/]/).pop() || 'document.pdf';
            file = new File([blob], fileName, { type: 'application/pdf' });
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to read file from path: ${errorMessage}`);
          }
        } else {
          file = fileOrPath;
          fileName = file.name;
          // For File objects, we can try to get the path if available
          console.log('Processing PDF from File object:', {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: new Date(file.lastModified).toISOString(),
          });
        }

        try {
          const base64Content = await readFileAsBase64(file);

          // Send PDF directly to background service worker
          await sendMessage({
            type: 'process_pdf',
            pdfData: {
              name: fileName,
              content: base64Content,
            },
            tabId,
          });

          appendMessage({
            actor: Actors.SYSTEM,
            content: `Processing PDF: ${fileName}...`,
            timestamp: Date.now(),
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error('PDF upload error', errorMessage);
          appendMessage({
            actor: Actors.SYSTEM,
            content: `Failed to process PDF: ${errorMessage}`,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('PDF upload error', errorMessage);
        appendMessage({
          actor: Actors.SYSTEM,
          content: `Failed to upload PDF: ${errorMessage}`,
          timestamp: Date.now(),
        });
      } finally {
        setUploadingPdf(false);
      }
    },
    [isHistoricalSession, setupConnection, sendMessage, appendMessage, portRef, readFileAsBase64],
  );

  return { uploadingPdf, handlePdfUpload };
};
