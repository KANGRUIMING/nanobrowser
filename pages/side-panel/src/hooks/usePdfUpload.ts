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
  handlePdfUpload: (file: File) => Promise<void>;
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

  const handlePdfUpload = useCallback(
    async (file: File) => {
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

        // Read file as base64
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64Content = reader.result?.toString().split(',')[1];

            if (!base64Content) {
              throw new Error('Failed to read PDF file');
            }

            // Send PDF directly to background service worker
            await sendMessage({
              type: 'process_pdf',
              pdfData: {
                name: file.name,
                content: base64Content,
              },
              tabId,
            });

            appendMessage({
              actor: Actors.SYSTEM,
              content: `Processing PDF: ${file.name}...`,
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
          } finally {
            setUploadingPdf(false);
          }
        };

        reader.onerror = () => {
          appendMessage({
            actor: Actors.SYSTEM,
            content: 'Failed to read PDF file',
            timestamp: Date.now(),
          });
          setUploadingPdf(false);
        };

        reader.readAsDataURL(file);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('PDF upload error', errorMessage);
        appendMessage({
          actor: Actors.SYSTEM,
          content: `Failed to upload PDF: ${errorMessage}`,
          timestamp: Date.now(),
        });
        setUploadingPdf(false);
      }
    },
    [isHistoricalSession, setupConnection, sendMessage, appendMessage, portRef],
  );

  return { uploadingPdf, handlePdfUpload };
};
