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
        // Don't allow uploads in historical sessions
        if (isHistoricalSession) {
          console.log('Cannot upload files in historical sessions');
          return;
        }

        setUploadingPdf(true);

        // Get the active tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) {
          throw new Error('No active tab found');
        }

        // Create a new session if needed
        if (!isFollowUpMode && !sessionIdRef.current) {
          const newSession = await chatHistoryStore.createSession(`PDF Upload: ${file.name}`);
          setCurrentSessionId(newSession.id);
          sessionIdRef.current = newSession.id;
        }

        // Add a user message indicating PDF upload
        const userMessage = {
          actor: Actors.USER,
          content: `Uploaded PDF: ${file.name}`,
          timestamp: Date.now(),
        };

        appendMessage(userMessage, sessionIdRef.current);

        // Setup connection if not exists
        if (!portRef.current) {
          setupConnection();
        }

        // Read file as base64
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64Content = reader.result?.toString().split(',')[1]; // Remove data URL prefix

            if (!base64Content) {
              throw new Error('Failed to read PDF file');
            }

            setInputEnabled(false);
            setShowStopButton(true);

            // Send PDF to background service worker
            if (isFollowUpMode) {
              // Send as follow-up with PDF
              await sendMessage({
                type: 'follow_up_task',
                task: `Process this PDF: ${file.name}`,
                taskId: sessionIdRef.current,
                tabId,
                pdfData: {
                  name: file.name,
                  content: base64Content,
                },
              });
            } else {
              // Send as new task with PDF
              await sendMessage({
                type: 'new_task',
                task: `Process this PDF: ${file.name}`,
                taskId: sessionIdRef.current,
                tabId,
                pdfData: {
                  name: file.name,
                  content: base64Content,
                },
              });
            }
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error('PDF upload error', errorMessage);
            appendMessage({
              actor: Actors.SYSTEM,
              content: `Failed to process PDF: ${errorMessage}`,
              timestamp: Date.now(),
            });
            setInputEnabled(true);
            setShowStopButton(false);
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
          setInputEnabled(true);
          setShowStopButton(false);
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
        setInputEnabled(true);
        setShowStopButton(false);
      }
    },
    [
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
    ],
  );

  return { uploadingPdf, handlePdfUpload };
};
