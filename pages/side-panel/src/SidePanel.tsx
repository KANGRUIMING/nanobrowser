/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';
import { RxDiscordLogo } from 'react-icons/rx';
import { FiSettings } from 'react-icons/fi';
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
import { type Message, Actors, chatHistoryStore } from '@extension/storage';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
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
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Job preference fields
  const [role, setRole] = useState('');
  const [positionType, setPositionType] = useState('');
  const [selectedDatePosted, setSelectedDatePosted] = useState('');
  const [preferredLocation, setPreferredLocation] = useState('');
  const [isRemote, setIsRemote] = useState(false);

  const [showJobPreferences, setShowJobPreferences] = useState(false);
  const [showUploadResume, setShowUploadResume] = useState(false);
  const [resumeText, setResumeText] = useState('');
  const sessionIdRef = useRef<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  const [isDisabled, setIsDisabled] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Check for dark mode preference - we're now forcing light mode
  useEffect(() => {
    // Always use light mode
    setIsDarkMode(false);
  }, []);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    const checkIfLinkedIn = async () => {
      // Get the current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Check if the current URL is LinkedIn
      const isLinkedIn = tab.url && tab.url.includes('linkedin.com');

      if (!isLinkedIn) {
        // If not on LinkedIn, show a message or disable functionality
        setIsDisabled(true);
      } else {
        setIsDisabled(false);
      }
    };

    checkIfLinkedIn();
    // Add a listener for tab changes
    chrome.tabs.onActivated.addListener(checkIfLinkedIn);
    chrome.tabs.onUpdated.addListener(checkIfLinkedIn);

    return () => {
      chrome.tabs.onActivated.removeListener(checkIfLinkedIn);
      chrome.tabs.onUpdated.removeListener(checkIfLinkedIn);
    };
  }, []);

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
        });
        console.log('follow_up_task sent', text, tabId, sessionIdRef.current);
      } else {
        // Send as new task
        await sendMessage({
          type: 'new_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
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
    // Clear messages and start a new chat
    setMessages([]);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    setInputEnabled(true);
    setShowStopButton(false);
    setIsFollowUpMode(false);
    setIsHistoricalSession(false);

    // Hide job preferences or resume upload if they're showing
    setShowJobPreferences(false);
    setShowUploadResume(false);

    // Disconnect any existing connection
    stopConnection();
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
    console.log('handleTemplateSelect', content);
    if (setInputTextRef.current) {
      setInputTextRef.current(content);
    }
  };

  // Define restricted position types and date posted options
  const positionTypes = ['Internship', 'Full-time'];

  const datePostedOptions = [
    { value: 'any', label: 'Any time' },
    { value: 'past_month', label: 'Past month' },
    { value: 'past_week', label: 'Past week' },
    { value: 'past_24h', label: 'Past 24 hours' },
  ];

  const handleSetJobPreferences = () => {
    setShowJobPreferences(true);
    setShowUploadResume(false);
  };

  const handleUploadResume = () => {
    setShowUploadResume(true);
    setShowJobPreferences(false);
  };

  const getDatePostedText = (value: string): string => {
    switch (value) {
      case 'past_month':
        return 'posted in the Past Month';
      case 'past_week':
        return 'posted in the Past Week';
      case 'past_24h':
        return 'posted in the Past 24 Hours';
      default:
        return '';
    }
  };

  const handleApplyNow = () => {
    // Ensure role doesn't exceed 30 characters
    const trimmedRole = role.trim().substring(0, 30);

    // Build search string from role and position type
    const searchString =
      trimmedRole && positionType
        ? `${trimmedRole} ${positionType}`
        : trimmedRole || (positionType ? `${positionType} job` : 'job');

    // Start building the message
    let message = `I'm looking for a ${searchString}`;

    // Add date posted if selected
    if (selectedDatePosted && selectedDatePosted !== 'any') {
      message += `, ${getDatePostedText(selectedDatePosted)}`;
    }

    // Add location if provided
    if (preferredLocation.trim()) {
      message += `, in ${preferredLocation.trim()}`;
    }

    // Add remote preference
    message += `, with Remote? set to ${isRemote ? 'Yes' : 'No'}`;

    // Add Easy Apply reference
    message += `. Use Easy Apply.`;

    // Add explicit automation instructions
    message += ` Please go to the LinkedIn search tab, type "${searchString}", and then navigate through the search result filters (date posted, remote, etc.) to match these preferences.`;

    // Add resume text if provided
    if (resumeText) {
      message += '\n\nHere is my resume:\n' + resumeText;
    }

    message += '\n\nCan you help me apply to suitable jobs that match my preferences and qualifications?';

    // Send the message using the existing function
    handleSendMessage(message);
  };

  // Create a custom handler for the resume input
  const handleResumeInputChange = (text: string) => {
    setResumeText(text);
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
    <div>
      <div className="flex h-screen flex-col bg-white overflow-hidden border border-gray-100 rounded-3xl shadow-sm">
        <header className="header relative">
          <div className="header-logo">
            {showHistory ? (
              <button
                type="button"
                onClick={handleBackToChat}
                className={`text-purple-500 hover:text-purple-700 cursor-pointer`}
                aria-label="Back to chat">
                ← Back
              </button>
            ) : (
              <span
                className="text-2xl font-semibold text-purple-500 cursor-pointer"
                onClick={handleNewChat}
                title="Return to home">
                Jawn
              </span>
            )}
          </div>
          <div className="header-icons">
            {!showHistory && (
              <>
                <button
                  type="button"
                  onClick={handleNewChat}
                  onKeyDown={e => e.key === 'Enter' && handleNewChat()}
                  className={`header-icon text-gray-700 hover:text-gray-900 cursor-pointer`}
                  aria-label="New Chat"
                  tabIndex={0}>
                  <PiPlusBold size={20} />
                </button>
                <button
                  type="button"
                  onClick={handleLoadHistory}
                  onKeyDown={e => e.key === 'Enter' && handleLoadHistory()}
                  className={`header-icon text-gray-700 hover:text-gray-900 cursor-pointer`}
                  aria-label="Load History"
                  tabIndex={0}>
                  <GrHistory size={20} />
                </button>
              </>
            )}
            <a
              href="https://discord.gg/NN3ABHggMK"
              target="_blank"
              rel="noopener noreferrer"
              className={`header-icon text-gray-700 hover:text-gray-900`}>
              <RxDiscordLogo size={20} />
            </a>
            <button
              type="button"
              onClick={() => chrome.runtime.openOptionsPage()}
              onKeyDown={e => e.key === 'Enter' && chrome.runtime.openOptionsPage()}
              className={`header-icon text-gray-700 hover:text-gray-900 cursor-pointer`}
              aria-label="Settings"
              tabIndex={0}>
              <FiSettings size={20} />
            </button>
          </div>
        </header>
        {showHistory ? (
          <div className="flex-1 overflow-hidden">
            <ChatHistoryList
              sessions={chatSessions}
              onSessionSelect={handleSessionSelect}
              onSessionDelete={handleSessionDelete}
              visible={true}
              isDarkMode={isDarkMode}
            />
          </div>
        ) : (
          <>
            {messages.length === 0 ? (
              <>
                {!showJobPreferences && !showUploadResume ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-4">
                    <div className="w-full max-w-sm space-y-4">
                      <button
                        onClick={handleSetJobPreferences}
                        className={`w-full py-3 px-4 rounded-full font-medium bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 transition-colors duration-200`}>
                        Set Job Preferences
                      </button>

                      <button
                        onClick={handleUploadResume}
                        className={`w-full py-3 px-4 rounded-full font-medium flex items-center justify-center bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 transition-colors duration-200`}>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5 mr-2"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12"
                          />
                        </svg>
                        Upload Resume
                      </button>

                      <button
                        onClick={handleApplyNow}
                        className={`w-full py-3 px-4 rounded-full font-medium bg-purple-500 hover:bg-purple-600 text-white transition-colors duration-200`}>
                        Apply Now
                      </button>
                    </div>
                  </div>
                ) : showUploadResume ? (
                  <div className="flex-1 flex flex-col">
                    <div
                      className={`border-t ${isDarkMode ? 'border-sky-900' : 'border-sky-100'} p-2 shadow-sm backdrop-blur-sm`}>
                      <ChatInput
                        onSendMessage={handleSendMessage}
                        onStopTask={handleStopTask}
                        disabled={!inputEnabled || isHistoricalSession}
                        showStopButton={showStopButton}
                        initialContent={resumeText}
                        setContent={setter => {
                          setInputTextRef.current = setter;
                        }}
                        onChange={handleResumeInputChange}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                      <div className="text-center mb-4">
                        <p className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                          Upload your resume or paste its content
                        </p>
                        <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Type or paste your resume content in the chat box above
                        </p>
                      </div>
                      <div className="flex justify-center">
                        <button
                          onClick={() => {
                            setShowUploadResume(false);
                          }}
                          className={`py-2 px-4 rounded ${
                            isDarkMode
                              ? 'bg-slate-700 hover:bg-slate-600 text-white'
                              : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                          }`}>
                          Back
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col overflow-y-auto">
                    <div className="p-1 flex-1">
                      {/* Role */}
                      <div className={`mb-4 px-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        <label
                          htmlFor="role"
                          className={`block text-sm font-medium ${isDarkMode ? 'text-sky-400' : 'text-sky-600'} mb-1`}>
                          Role
                        </label>
                        <input
                          id="role"
                          type="text"
                          value={role}
                          onChange={e => setRole(e.target.value.substring(0, 30))}
                          placeholder="e.g., Software Engineer"
                          maxLength={30}
                          className={`w-full px-3 py-2 rounded-md border ${
                            isDarkMode
                              ? 'bg-slate-800 border-sky-800 text-white placeholder-gray-400'
                              : 'bg-white border-sky-200 text-gray-800 placeholder-gray-500'
                          } focus:outline-none focus:ring-2 ${isDarkMode ? 'focus:ring-sky-500' : 'focus:ring-sky-300'}`}
                        />
                        <div
                          className={`text-xs mt-1 text-right ${
                            role.length >= 25 ? 'text-orange-500' : isDarkMode ? 'text-gray-400' : 'text-gray-500'
                          }`}>
                          {role.length}/30
                        </div>
                      </div>

                      {/* Position Type - restricted to just Internship and Full-time */}
                      <div className={`mb-4 px-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        <label
                          className={`block text-sm font-medium ${isDarkMode ? 'text-sky-400' : 'text-sky-600'} mb-2`}>
                          Position Type
                        </label>
                        <div className="flex gap-4">
                          {positionTypes.map(type => (
                            <div key={type} className="flex items-center">
                              <input
                                id={`positionType-${type}`}
                                type="radio"
                                name="positionType"
                                value={type}
                                checked={positionType === type}
                                onChange={() => setPositionType(type)}
                                className={`h-4 w-4 ${
                                  isDarkMode
                                    ? 'border-sky-700 bg-slate-700 text-sky-500'
                                    : 'border-sky-300 text-sky-600'
                                } focus:ring-2 focus:ring-sky-400`}
                              />
                              <label htmlFor={`positionType-${type}`} className="ml-2 block text-sm">
                                {type}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Date Posted */}
                      <div className={`mb-4 px-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        <label
                          className={`block text-sm font-medium ${isDarkMode ? 'text-sky-400' : 'text-sky-600'} mb-2`}>
                          Date Posted
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {datePostedOptions.map(option => (
                            <div key={option.value} className="flex items-center">
                              <input
                                id={`datePosted-${option.value}`}
                                type="radio"
                                name="datePosted"
                                value={option.value}
                                checked={selectedDatePosted === option.value}
                                onChange={() => setSelectedDatePosted(option.value)}
                                className={`h-4 w-4 ${
                                  isDarkMode
                                    ? 'border-sky-700 bg-slate-700 text-sky-500'
                                    : 'border-sky-300 text-sky-600'
                                } focus:ring-2 focus:ring-sky-400`}
                              />
                              <label htmlFor={`datePosted-${option.value}`} className="ml-2 block text-sm">
                                {option.label}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Preferred Location */}
                      <div className={`mb-4 px-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        <label
                          htmlFor="preferredLocation"
                          className={`block text-sm font-medium ${isDarkMode ? 'text-sky-400' : 'text-sky-600'} mb-1`}>
                          Preferred Location
                        </label>
                        <input
                          id="preferredLocation"
                          type="text"
                          value={preferredLocation}
                          onChange={e => setPreferredLocation(e.target.value)}
                          placeholder="e.g., New York, Remote, San Francisco"
                          className={`w-full px-3 py-2 rounded-md border ${
                            isDarkMode
                              ? 'bg-slate-800 border-sky-800 text-white placeholder-gray-400'
                              : 'bg-white border-sky-200 text-gray-800 placeholder-gray-500'
                          } focus:outline-none focus:ring-2 ${isDarkMode ? 'focus:ring-sky-500' : 'focus:ring-sky-300'}`}
                        />
                      </div>

                      {/* Remote? */}
                      <div className={`mb-4 px-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        <div className="flex items-center">
                          <input
                            id="isRemote"
                            type="checkbox"
                            checked={isRemote}
                            onChange={e => setIsRemote(e.target.checked)}
                            className={`h-4 w-4 rounded ${
                              isDarkMode ? 'border-sky-700 bg-slate-700 text-sky-500' : 'border-sky-300 text-sky-600'
                            } focus:ring-2 focus:ring-sky-400`}
                          />
                          <label
                            htmlFor="isRemote"
                            className={`ml-2 block text-sm font-medium ${isDarkMode ? 'text-sky-400' : 'text-sky-600'}`}>
                            Remote?
                          </label>
                        </div>
                      </div>

                      <div className="flex justify-end px-3 mb-4">
                        <button
                          onClick={() => setShowJobPreferences(false)}
                          className={`mr-2 py-2 px-4 rounded ${
                            isDarkMode
                              ? 'bg-slate-700 hover:bg-slate-600 text-white'
                              : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                          }`}>
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            // Save preferences and return to initial view
                            setShowJobPreferences(false);
                          }}
                          className={`py-2 px-4 rounded ${
                            isDarkMode
                              ? 'bg-sky-600 hover:bg-sky-500 text-white'
                              : 'bg-sky-500 hover:bg-sky-400 text-white'
                          }`}>
                          Save Preferences
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div
                  className={`scrollbar-gutter-stable flex-1 overflow-x-hidden overflow-y-scroll scroll-smooth p-2 ${isDarkMode ? 'bg-slate-900/80' : ''}`}>
                  {isDisabled ? (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                      <img src="/icon-128.png" alt="Extension Logo" className="w-16 h-16 mb-4" />
                      <h3 className={`text-xl font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        LinkedIn Assistant
                      </h3>
                      <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        This assistant only works on LinkedIn websites. Please navigate to LinkedIn to use this feature.
                      </p>
                      <a
                        href="https://www.linkedin.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`py-2 px-4 rounded ${
                          isDarkMode
                            ? 'bg-sky-600 hover:bg-sky-500 text-white'
                            : 'bg-sky-500 hover:bg-sky-400 text-white'
                        }`}>
                        Go to LinkedIn
                      </a>
                    </div>
                  ) : (
                    <>
                      <MessageList messages={messages} isDarkMode={isDarkMode} />
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>
                <div
                  className={`border-t ${isDarkMode ? 'border-sky-900' : 'border-sky-100'} p-2 shadow-sm backdrop-blur-sm`}>
                  <ChatInput
                    onSendMessage={handleSendMessage}
                    onStopTask={handleStopTask}
                    disabled={!inputEnabled || isHistoricalSession}
                    showStopButton={showStopButton}
                    setContent={setter => {
                      setInputTextRef.current = setter;
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SidePanel;
