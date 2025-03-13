/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';
import { RxDiscordLogo } from 'react-icons/rx';
import { FiSettings } from 'react-icons/fi';
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
import { type Message, Actors, chatHistoryStore } from '@extension/storage';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import JobApplicationInput from './components/JobApplicationInput';
import ChatHistoryList from './components/ChatHistoryList';
import TemplateList from './components/TemplateList';
import { EventType, type AgentEvent, ExecutionState } from './types/event';
import { defaultTemplates } from './templates';
import './SidePanel.css';

const SidePanel = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputEnabled, setInputEnabled] = useState(true);
  const [showStopButton, setShowStopButton] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; createdAt: number }>>([]);
  const [isFollowUpMode, setIsFollowUpMode] = useState(false);
  const [isHistoricalSession, setIsHistoricalSession] = useState(false);
  const [currentResumeData, setCurrentResumeData] = useState<any>(null);
  const [currentJobKeywords, setCurrentJobKeywords] = useState<string[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const appendMessage = useCallback((newMessage: Message, sessionId?: string | null) => {
    // Don't save progress messages
    const isProgressMessage = newMessage.content === 'Showing progress...';

    setMessages(prev => {
      const filteredMessages = prev.filter(
        (msg, idx) => !(msg.content === 'Showing progress...' && idx === prev.length - 1),
      );
      return [...filteredMessages, newMessage];
    });

    // Use provided sessionId if available, otherwise fall back to sessionIdRef.current
    const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;

    console.log('sessionId', effectiveSessionId);

    // Save message to storage if we have a session and it's not a progress message
    if (effectiveSessionId && !isProgressMessage) {
      chatHistoryStore
        .addMessage(effectiveSessionId, newMessage)
        .catch(err => console.error('Failed to save message to history:', err));
    }
  }, []);

  const handleTaskState = useCallback(
    (event: AgentEvent) => {
      const { actor, state, timestamp, data } = event;
      const content = data?.details;
      let skip = true;
      let displayProgress = false;

      switch (actor) {
        case Actors.SYSTEM:
          switch (state) {
            case ExecutionState.TASK_START:
              // Reset historical session flag when a new task starts
              setIsHistoricalSession(false);
              break;
            case ExecutionState.TASK_OK:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              break;
            case ExecutionState.TASK_FAIL:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              skip = false;
              break;
            case ExecutionState.TASK_CANCEL:
              setIsFollowUpMode(false);
              setInputEnabled(true);
              setShowStopButton(false);
              skip = false;
              break;
            case ExecutionState.TASK_PAUSE:
              break;
            case ExecutionState.TASK_RESUME:
              break;
            default:
              console.error('Invalid task state', state);
              return;
          }
          break;
        case Actors.USER:
          break;
        case Actors.PLANNER:
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              skip = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              break;
            case ExecutionState.STEP_CANCEL:
              break;
            default:
              console.error('Invalid step state', state);
              return;
          }
          break;
        case Actors.NAVIGATOR:
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              displayProgress = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              displayProgress = false;
              break;
            case ExecutionState.STEP_CANCEL:
              displayProgress = false;
              break;
            case ExecutionState.ACT_START:
              if (content !== 'cache_content') {
                // skip to display caching content
                skip = false;
              }
              break;
            case ExecutionState.ACT_OK:
              skip = true;
              break;
            case ExecutionState.ACT_FAIL:
              skip = false;
              break;
            default:
              console.error('Invalid action', state);
              return;
          }
          break;
        case Actors.VALIDATOR:
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              skip = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              break;
            default:
              console.error('Invalid validation', state);
              return;
          }
          break;
        default:
          console.error('Unknown actor', actor);
          return;
      }

      if (!skip) {
        appendMessage({
          actor,
          content: content || '',
          timestamp: timestamp,
        });
      }

      if (displayProgress) {
        appendMessage({
          actor,
          content: 'Showing progress...',
          timestamp: timestamp,
        });
      }
    },
    [appendMessage],
  );

  // Stop heartbeat and close connection
  const stopConnection = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (portRef.current) {
      portRef.current.disconnect();
      portRef.current = null;
    }
  }, []);

  // Setup connection management
  const setupConnection = useCallback(() => {
    // Only setup if no existing connection
    if (portRef.current) {
      return;
    }

    try {
      portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });

      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      portRef.current.onMessage.addListener((message: any) => {
        // Add type checking for message
        if (message && message.type === EventType.EXECUTION) {
          handleTaskState(message);
        } else if (message && message.type === 'error') {
          // Handle error messages from service worker
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || 'Unknown error occurred',
            timestamp: Date.now(),
          });
          setInputEnabled(true);
          setShowStopButton(false);
        } else if (message && message.type === 'heartbeat_ack') {
          console.log('Heartbeat acknowledged');
        }
      });

      portRef.current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.log('Connection disconnected', error ? `Error: ${error.message}` : '');
        portRef.current = null;
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        setInputEnabled(true);
        setShowStopButton(false);
      });

      // Setup heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = window.setInterval(() => {
        if (portRef.current?.name === 'side-panel-connection') {
          try {
            portRef.current.postMessage({ type: 'heartbeat' });
          } catch (error) {
            console.error('Heartbeat failed:', error);
            stopConnection(); // Stop connection if heartbeat fails
          }
        } else {
          stopConnection(); // Stop if port is invalid
        }
      }, 25000);
    } catch (error) {
      console.error('Failed to establish connection:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: 'Failed to connect to service worker',
        timestamp: Date.now(),
      });
      // Clear any references since connection failed
      portRef.current = null;
    }
  }, [handleTaskState, appendMessage, stopConnection]);

  // Add safety check for message sending
  const sendMessage = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    (message: any) => {
      if (portRef.current?.name !== 'side-panel-connection') {
        throw new Error('No valid connection available');
      }
      try {
        portRef.current.postMessage(message);
      } catch (error) {
        console.error('Failed to send message:', error);
        stopConnection(); // Stop connection when message sending fails
        throw error;
      }
    },
    [stopConnection],
  );

  const handleJobApplicationSubmit = async (resumeData: any, keywords: string[]) => {
    if (!resumeData || keywords.length === 0) return;

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      setInputEnabled(false);
      setShowStopButton(true);

      // Store the resume data and keywords
      setCurrentResumeData(resumeData);
      setCurrentJobKeywords(keywords);

      // Create a default task message based on keywords
      const taskMessage = `Find and apply to jobs matching these keywords: ${keywords.join(', ')}`;

      // Create a new chat session for this task
      const newSession = await chatHistoryStore.createSession(
        `Job Search: ${keywords.join(', ')}`.substring(0, 50) + (keywords.join(', ').length > 30 ? '...' : ''),
      );

      // Store the session ID in both state and ref
      const sessionId = newSession.id;
      setCurrentSessionId(sessionId);
      sessionIdRef.current = sessionId;

      const userMessage = {
        actor: Actors.USER,
        content: taskMessage,
        timestamp: Date.now(),
      };

      // Pass the sessionId directly to appendMessage
      appendMessage(userMessage, sessionIdRef.current);

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Convert PDF content to text for LLM prompt if necessary
      // The PDF was loaded as an ArrayBuffer and marked with isPdf flag
      let processedResumeData = resumeData;

      if (resumeData.isPdf) {
        // For PDF files, we convert the fileName and estimated size info
        // This indicates to the backend that the resume is a PDF
        // and should be treated as a text representation
        processedResumeData = {
          resumeText: `PDF Resume: ${resumeData.fileName} (approximately ${resumeData.estimatedWords} words)`,
          originalFormat: 'PDF',
        };

        // Add a message to indicate to the user that only the text content will be used
        appendMessage({
          actor: Actors.SYSTEM,
          content: 'Your PDF resume has been processed. Only the text content will be used to fill job applications.',
          timestamp: Date.now(),
        });
      }

      // Send message with resume data and job keywords
      await sendMessage({
        type: 'new_task',
        task: taskMessage,
        taskId: sessionIdRef.current,
        tabId,
        resumeData: processedResumeData,
        jobKeywords: keywords,
      });

      console.log('job_application task sent', taskMessage, tabId, sessionIdRef.current);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setInputEnabled(true);
      setShowStopButton(false);
      stopConnection();
    }
  };

  const handleSendMessage = async (text: string) => {
    console.log('handleSendMessage', text);

    if (!text.trim()) return;

    // Block sending messages in historical sessions
    if (isHistoricalSession) {
      console.log('Cannot send messages in historical sessions');
      return;
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      setInputEnabled(false);
      setShowStopButton(true);

      // Create a new chat session for this task if not in follow-up mode
      if (!isFollowUpMode) {
        const newSession = await chatHistoryStore.createSession(
          text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        );
        console.log('newSession', newSession);

        // Store the session ID in both state and ref
        const sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        sessionIdRef.current = sessionId;
      }

      const userMessage = {
        actor: Actors.USER,
        content: text,
        timestamp: Date.now(),
      };

      // Pass the sessionId directly to appendMessage
      appendMessage(userMessage, sessionIdRef.current);

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Send message using the utility function
      if (isFollowUpMode) {
        // Send as follow-up task
        await sendMessage({
          type: 'follow_up_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
          resumeData: currentResumeData,
          jobKeywords: currentJobKeywords,
        });
        console.log('follow_up_task sent', text, tabId, sessionIdRef.current);
      } else {
        // Send as new task
        await sendMessage({
          type: 'new_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
          resumeData: currentResumeData,
          jobKeywords: currentJobKeywords,
        });
        console.log('new_task sent', text, tabId, sessionIdRef.current);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setInputEnabled(true);
      setShowStopButton(false);
      stopConnection();
    }
  };

  const handleStopTask = async () => {
    try {
      portRef.current?.postMessage({
        type: 'cancel_task',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('cancel_task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
    }
    setInputEnabled(true);
    setShowStopButton(false);
  };

  const handleNewChat = () => {
    setMessages([]);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    setIsFollowUpMode(false);
    setIsHistoricalSession(false);
    setCurrentResumeData(null);
    setCurrentJobKeywords([]);
  };

  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await chatHistoryStore.getSessionsMetadata();
      setChatSessions(sessions.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    }
  }, []);

  const handleLoadHistory = async () => {
    await loadChatSessions();
    setShowHistory(true);
  };

  const handleBackToChat = () => {
    setShowHistory(false);
  };

  const handleSessionSelect = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);
      if (fullSession && fullSession.messages.length > 0) {
        setCurrentSessionId(fullSession.id);
        setMessages(fullSession.messages);
        setIsFollowUpMode(false);
        setIsHistoricalSession(true); // Mark this as a historical session
      }
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };

  const handleSessionDelete = async (sessionId: string) => {
    try {
      await chatHistoryStore.deleteSession(sessionId);
      await loadChatSessions();
      if (sessionId === currentSessionId) {
        setMessages([]);
        setCurrentSessionId(null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleTemplateSelect = (content: string) => {
    if (setInputTextRef.current) {
      setInputTextRef.current(content);
    } else {
      // For job application mode, populate the keywords field
      const keywordsList = content
        .split(',')
        .map(k => k.trim())
        .filter(k => k !== '');
      setCurrentJobKeywords(keywordsList);

      // Prompt the user to upload their resume if they haven't already
      if (!currentResumeData) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: "I've set the job keywords for you. Please upload your resume to start the job search.",
          timestamp: Date.now(),
        });
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopConnection();
    };
  }, [stopConnection]);

  // Scroll to bottom when new messages arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-title">Job Application Agent</div>
        <div className="app-actions">
          <button className="icon-button" onClick={handleNewChat} title="New chat">
            <PiPlusBold className="icon" />
          </button>
          <button className="icon-button" onClick={handleLoadHistory} title="View history">
            <GrHistory className="icon" />
          </button>
          <button onClick={() => chrome.runtime.openOptionsPage()} className="icon-button" title="Settings">
            <FiSettings className="icon" />
          </button>
        </div>
      </header>

      <main className="chat-container">
        {showHistory ? (
          <div className="chat-history-container">
            <button className="back-button" onClick={handleBackToChat}>
              &lt; Back to Chat
            </button>
            <h3 className="history-title">Chat History</h3>
            <ChatHistoryList sessions={chatSessions} onSelect={handleSessionSelect} onDelete={handleSessionDelete} />
          </div>
        ) : (
          <>
            <div className="message-list-container" ref={messagesEndRef}>
              <MessageList messages={messages} />
            </div>

            {!isFollowUpMode && !isHistoricalSession && messages.length === 0 ? (
              // Show job application input for new sessions
              <JobApplicationInput onSubmit={handleJobApplicationSubmit} disabled={!inputEnabled} />
            ) : (
              // Show regular chat input for follow-up messages or historical sessions
              <ChatInput
                onSendMessage={handleSendMessage}
                onStopTask={handleStopTask}
                disabled={!inputEnabled || isHistoricalSession}
                showStopButton={showStopButton}
                setContent={setter => {
                  setInputTextRef.current = setter;
                }}
              />
            )}

            {messages.length === 0 && !showHistory && (
              <div className="template-container">
                <h3 className="template-title">Suggested Job Search Keywords</h3>
                <TemplateList
                  templates={defaultTemplates}
                  onSelect={handleTemplateSelect}
                  disabled={!inputEnabled || isHistoricalSession}
                />
              </div>
            )}
          </>
        )}
      </main>

      <footer className="app-footer">
        <div className="text-gray-500 text-sm">Job Application Agent</div>
      </footer>
    </div>
  );
};

export default SidePanel;
