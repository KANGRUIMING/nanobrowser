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

// Add this global declaration at the top level of the file
declare global {
  interface Window {
    _easyApplyObserver: MutationObserver | null;
  }
}

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
  const [numApplications, setNumApplications] = useState(1);

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

  // Add this ref at the top of your component
  const lastMessageTime = useRef<number>(0);

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

  // Add a rate-limited version of appendMessage
  const rateLimit = (fn: (...args: any[]) => void, delay: number) => {
    let lastCall = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let queuedArgs: any[] | null = null;

    return (...args: any[]) => {
      const now = Date.now();

      if (now - lastCall < delay) {
        // Queue this call to execute after delay
        if (timeoutId) clearTimeout(timeoutId);
        queuedArgs = args;

        timeoutId = setTimeout(
          () => {
            if (queuedArgs) {
              lastCall = Date.now();
              fn(...queuedArgs);
              queuedArgs = null;
            }
          },
          delay - (now - lastCall),
        );
      } else {
        // Execute immediately
        lastCall = now;
        fn(...args);
      }
    };
  };

  // Create a rate-limited appendMessage function
  const throttledAppendMessage = useCallback(
    rateLimit((message: Message, sessionId?: string | null) => {
      appendMessage(message, sessionId);
    }, 1000), // Limit to one message per second
    [appendMessage],
  );

  const handleTaskState = useCallback(
    (event: AgentEvent) => {
      // Add a rate limiter - process at most one message every 1 second
      const now = Date.now();
      if (now - lastMessageTime.current < 1000) {
        // Queue this message to be processed after delay
        setTimeout(() => handleTaskState(event), 1000 - (now - lastMessageTime.current));
        return;
      }

      lastMessageTime.current = now;

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
    const dateMap: { [key: string]: string } = {
      past_24h: 'Past 24 hours',
      past_week: 'Past week',
      past_month: 'Past month',
      any: 'Any time',
    };
    return dateMap[value] || 'Any time';
  };

  // Function to check if Apply Now button should be enabled
  const isApplyEnabled = (): boolean => {
    // Require at least a resume and role to be set
    return Boolean(resumeText) && Boolean(role.trim());
  };

  const handleApplyNow = async () => {
    try {
      console.log('Starting job application process...');

      // Reset state to ensure clean start
      if (showStopButton) {
        console.log('Stopping any ongoing tasks before starting new job application');
        handleStopTask();
      }

      // Ensure role doesn't exceed 30 characters
      const trimmedRole = role.trim().substring(0, 30);

      // Determine search parameters
      const searchParams = {
        query: trimmedRole || (positionType ? `${positionType} job` : 'job'),
        location: preferredLocation.trim() || undefined,
        experienceLevel: positionType || undefined,
        datePosted: selectedDatePosted !== 'any' ? selectedDatePosted : undefined,
        remoteOption: isRemote,
        easyApplyOnly: true,
      };

      console.log('Search parameters:', JSON.stringify(searchParams));

      // Create a new chat session specifically for this job application task
      if (!isFollowUpMode) {
        try {
          const sessionTitle = `Job Search: ${searchParams.query}${searchParams.location ? ' in ' + searchParams.location : ''}`;
          const newSession = await chatHistoryStore.createSession(sessionTitle);
          console.log('Created new session for job application:', newSession);

          setCurrentSessionId(newSession.id);
          sessionIdRef.current = newSession.id;
        } catch (err) {
          console.error('Failed to create session for job application:', err);
          // Continue without session if creation fails
        }
      }

      // Add a message to show that the search is being initiated
      appendMessage(
        {
          actor: Actors.SYSTEM,
          content: `Opening LinkedIn job search in a new tab for: ${searchParams.query} ${searchParams.location ? 'in ' + searchParams.location : ''} ${searchParams.datePosted ? '(' + getDatePostedText(selectedDatePosted) + ')' : ''} ${searchParams.remoteOption ? '(Remote)' : ''}`,
          timestamp: Date.now(),
        },
        sessionIdRef.current,
      );

      // Skip background messaging and directly construct the URL
      const url = createLinkedInSearchUrl(searchParams);
      console.log('Generated LinkedIn search URL:', url);

      // Open the LinkedIn search in a new tab and get the tab reference
      const newTab = window.open(url, '_blank');
      console.log('LinkedIn search opened via direct navigation');

      // Wait a bit before executing the content script to ensure the page loads
      setTimeout(async () => {
        try {
          console.log('Getting active tab to inject Easy Apply button observer...');
          // Get current tab to execute content script
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tabId = tabs[0]?.id;

          if (tabId) {
            console.log('Executing content script on tab ID:', tabId);
            // Execute a content script to click Easy Apply buttons
            chrome.scripting
              .executeScript({
                target: { tabId },
                func: findAndClickEasyApplyButtons,
              })
              .then(() => {
                console.log('Easy Apply button observer script injected successfully');

                // Add instructions about automatically clicking Easy Apply
                appendMessage({
                  actor: Actors.SYSTEM,
                  content: `The extension will automatically click on "Easy Apply" buttons when jobs are selected. Please select a job listing to begin.`,
                  timestamp: Date.now(),
                });

                // Only proceed with sending resume prompt if we have a resume
                if (resumeText) {
                  console.log('Resume found, preparing to send job application prompt...');
                  // Wait longer before sending the prompt to ensure user has time to see a job listing
                  setTimeout(() => {
                    sendJobApplicationPrompt(resumeText, numApplications);
                  }, 3000); // Wait 3 seconds after injecting the button observer
                } else {
                  console.log('No resume found, skipping application prompt');
                  // If no resume is uploaded, inform the user
                  appendMessage({
                    actor: Actors.SYSTEM,
                    content: `Note: You haven't uploaded your resume yet. To enable AI assistance with job applications, please upload your resume by clicking the "Upload Resume" button.`,
                    timestamp: Date.now(),
                  });
                }
              })
              .catch(err => {
                console.error('Failed to inject Easy Apply button observer:', err);
              });
          } else {
            console.error('No active tab found for injecting Easy Apply button observer');
          }
        } catch (err) {
          console.error('Error while setting up Easy Apply button observer:', err);
        }
      }, 1500); // Wait 1.5 seconds before injecting the button observer
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Navigation error', errorMessage);

      // Report error using the agent system's pattern
      appendMessage(
        {
          actor: Actors.SYSTEM,
          content: `Error starting job application process: ${errorMessage}`,
          timestamp: Date.now(),
        },
        sessionIdRef.current,
      );

      // Reset UI state to allow retry
      setInputEnabled(true);
      setShowStopButton(false);

      // Ensure connection is stopped on error
      stopConnection();
    }
  };

  // Modify the sendJobApplicationPrompt function to better integrate with the agent logic
  const sendJobApplicationPrompt = (resume: string, applications: number) => {
    console.log(`Sending job application prompt for ${applications} application(s)...`);

    const jobApplyPrompt = `Apply to ${applications} job(s) that are displayed on this LinkedIn page that match my qualifications.

MY RESUME:
${resume}

INSTRUCTIONS:
1. Use my resume information to fill out the job applications.
2. For each application:
   - Ensure all required fields are completed with information from my resume
   - Check first if the fields in the application are already filled with information from my resume
   - Answer any screening questions based on my qualifications
   - If you encounter additional questions (scroll down to check), answer them thoroughly
   
3. Skip applications that:
   - Require assessment tests
   - Request information not found in my resume

If you can't proceed with an application, most likely there are additional fields that are not filled in or incorrectly filled in.
Check if there are additional fields or questions that need to be answered (often at the bottom of the form).

Please proceed with applying to ${applications} suitable position(s). Let me know which jobs you've applied to.`;

    console.log('Job application prompt prepared, sending to handleSendMessage...');

    // Instead of immediately sending, check the connection state first
    if (!portRef.current) {
      console.log('No active connection, setting up connection before sending message');
      setupConnection();
    }

    // Update UI state to reflect that a task is starting
    setInputEnabled(false);
    setShowStopButton(true);

    // Then send the message
    handleSendMessage(jobApplyPrompt);
  };

  // Improve findAndClickEasyApplyButtons to report back to the agent
  function findAndClickEasyApplyButtons() {
    console.log('[Content Script] Starting Easy Apply button observer setup');

    // Check if we already have an observer running to prevent duplicates
    if (window._easyApplyObserver) {
      console.log('[Content Script] Observer already exists, not creating a new one');
      return;
    }

    console.log('[Content Script] Setting up Easy Apply button observer');

    // Throttle the button search to reduce CPU usage
    let lastCheckTime = 0;
    const THROTTLE_MS = 500; // Only check every 500ms
    let buttonsFound = 0;
    let buttonsClicked = 0;

    // Create a throttled button check function
    const checkForButtons = () => {
      const now = Date.now();
      if (now - lastCheckTime < THROTTLE_MS) return;
      lastCheckTime = now;

      const easyApplyButtons = document.querySelectorAll('button.jobs-apply-button');
      if (easyApplyButtons.length > 0) {
        console.log(`[Content Script] Found ${easyApplyButtons.length} Easy Apply button(s)`);
        buttonsFound = easyApplyButtons.length;

        for (const button of Array.from(easyApplyButtons)) {
          if (button.textContent && button.textContent.includes('Easy Apply')) {
            console.log('[Content Script] Clicking Easy Apply button');
            (button as HTMLElement).click();
            buttonsClicked++;

            // Try to send a message back to the extension via postMessage
            try {
              window.postMessage(
                {
                  type: 'EASY_APPLY_CLICKED',
                  source: 'linkedin-assistant',
                  buttonText: button.textContent,
                  totalClicked: buttonsClicked,
                },
                '*',
              );
            } catch (err) {
              console.error('[Content Script] Failed to post message back to extension', err);
            }

            break; // Click only the first button found
          }
        }
      } else {
        // Only log if we previously found buttons and now they're gone
        if (buttonsFound > 0) {
          console.log('[Content Script] No Easy Apply buttons currently visible');
          buttonsFound = 0;
        }
      }
    };

    // Be more selective about what we observe - only watch the job listings area
    // instead of the entire document
    const targetNode =
      document.querySelector('.jobs-search-results-list') ||
      document.querySelector('.jobs-search__job-details') ||
      document.body;

    console.log(`[Content Script] Target node for observer: ${targetNode.tagName}, class: ${targetNode.className}`);

    // Create our observer with more efficient options
    const observer = new MutationObserver(mutations => {
      console.log(`[Content Script] DOM mutations detected: ${mutations.length}`);
      checkForButtons();
    });

    // Store the observer in a global variable so we can check for its existence
    window._easyApplyObserver = observer;

    // Start observing with more restrictive options
    observer.observe(targetNode, {
      childList: true, // Watch for added/removed elements
      subtree: true, // Watch child elements
      attributes: false, // Don't watch attributes (reduces overhead)
      characterData: false, // Don't watch text changes (reduces overhead)
    });

    console.log('[Content Script] Observer started successfully');

    // Do an initial check for buttons
    console.log('[Content Script] Performing initial button check');
    setTimeout(checkForButtons, 1000);

    // Perform additional checks at regular intervals
    const checkInterval = setInterval(() => {
      console.log('[Content Script] Performing scheduled button check');
      checkForButtons();
    }, 3000); // Check every 3 seconds

    // Auto-disconnect after 5 minutes to prevent memory leaks
    setTimeout(
      () => {
        if (window._easyApplyObserver) {
          console.log('[Content Script] Auto-disconnecting Easy Apply observer after timeout');
          window._easyApplyObserver.disconnect();
          window._easyApplyObserver = null;
          clearInterval(checkInterval);
        }
      },
      5 * 60 * 1000,
    );
  }

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

  // Add this function in the component (or extract to a separate file if preferred)
  const createLinkedInSearchUrl = (params: {
    query: string;
    location?: string;
    experienceLevel?: string;
    jobType?: string;
    datePosted?: string;
    remoteOption?: boolean;
    easyApplyOnly?: boolean;
  }): string => {
    // Build the LinkedIn URL with parameters
    const keywords = encodeURIComponent(params.query || 'jobs');
    const location = params.location ? `&location=${encodeURIComponent(params.location)}` : '';

    // Map experience level from text to LinkedIn's numeric codes
    let expLevel = '';
    if (params.experienceLevel) {
      const expMap: { [key: string]: string } = {
        'entry level': '1',
        associate: '2',
        'mid-senior level': '3',
        director: '4',
        executive: '5',
        // Map UI options to LinkedIn parameters
        internship: '1',
        'full-time': '2,3,4,5,6', // Map full-time to all professional experience levels
      };
      const level = expMap[params.experienceLevel.toLowerCase()];
      if (level) expLevel = `&f_E=${level}`;
    }

    // Map job type to LinkedIn's format
    let jobType = '';
    if (params.jobType) {
      const jobMap: { [key: string]: string } = {
        'full-time': 'FULLTIME',
        'part-time': 'PARTTIME',
        contract: 'CONTRACT',
        internship: 'INTERNSHIP',
        temporary: 'TEMPORARY',
      };
      const type = jobMap[params.jobType.toLowerCase()];
      if (type) jobType = `&f_JT=${type}`;
    }

    // Add date posted filter if provided
    let datePosted = '';
    if (params.datePosted) {
      const dateMap: { [key: string]: string } = {
        past_24h: 'r86400',
        past_week: 'r604800',
        past_month: 'r2592000',
      };
      const date = dateMap[params.datePosted];
      if (date) datePosted = `&f_TPR=${date}`;
    }

    // Add Easy Apply filter
    const easyApply = params.easyApplyOnly ? '&f_LF=f_AL' : '';

    // Add remote filter if set
    const remote = params.remoteOption ? '&f_WT=2' : '';

    // Construct the full URL
    return `https://www.linkedin.com/jobs/search/?keywords=${keywords}${location}${expLevel}${jobType}${datePosted}${remote}${easyApply}`;
  };

  // Add a timeout that forces resetting UI state if agent is stuck for too long
  useEffect(() => {
    // If showStopButton is true for more than 3 minutes, something is wrong
    if (showStopButton) {
      const timeoutId = setTimeout(
        () => {
          console.log('Agent appears to be stuck - resetting UI state');
          setShowStopButton(false);
          setInputEnabled(true);
          stopConnection();

          // Notify user
          appendMessage({
            actor: Actors.SYSTEM,
            content: 'The agent seems to be taking too long. Operation has been cancelled. Please try again.',
            timestamp: Date.now(),
          });
        },
        3 * 60 * 1000,
      ); // 3 minutes

      return () => clearTimeout(timeoutId);
    }
  }, [showStopButton, appendMessage, stopConnection]);

  // Add a listener for messages from content scripts
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Verify origin and structure
      if (event.data.source === 'linkedin-assistant') {
        if (event.data.type === 'EASY_APPLY_CLICKED') {
          console.log('Received Easy Apply button click notification:', event.data);

          // Add a system message to inform the user
          appendMessage({
            actor: Actors.SYSTEM,
            content: `Easy Apply button clicked for a job listing. Application form should now be open.`,
            timestamp: Date.now(),
          });
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [appendMessage]);

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
                {/* 
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
                */}
              </>
            )}
            {/* 
            <a
              href="https://discord.gg/NN3ABHggMK"
              target="_blank"
              rel="noopener noreferrer"
              className={`header-icon text-gray-700 hover:text-gray-900`}>
              <RxDiscordLogo size={20} />
            </a>
            */}
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
                        className={`w-full py-3 px-4 rounded-full font-medium bg-white hover:bg-gray-50 text-gray-800 border border-purple-200 transition-colors duration-200`}>
                        Set Job Preferences
                      </button>

                      <button
                        onClick={handleUploadResume}
                        className={`w-full py-3 px-4 rounded-full font-medium flex items-center justify-center bg-white hover:bg-gray-50 text-gray-800 border border-purple-200 transition-colors duration-200`}>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5 mr-2 text-purple-500"
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
                        disabled={!isApplyEnabled()}
                        className={`w-full py-3 px-4 rounded-full font-medium bg-purple-500 hover:bg-purple-600 text-white transition-colors duration-200 ${
                          !isApplyEnabled() ? 'opacity-50 cursor-not-allowed' : ''
                        }`}>
                        Apply Now
                      </button>
                    </div>
                  </div>
                ) : showUploadResume ? (
                  <div className="flex-1 flex flex-col p-4">
                    <div className="text-center mb-4">
                      <p className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        Upload your resume or paste its content
                      </p>
                      <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Type or paste your resume content in the box below
                      </p>
                    </div>

                    <div className="flex-1">
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
                        hideSendButton={true}
                        rows={15}
                        placeholder="Paste your resume here..."
                      />
                    </div>

                    <div className="mt-4 flex justify-center">
                      <button
                        onClick={() => {
                          setShowUploadResume(false);
                        }}
                        className={`py-2 px-8 rounded-lg text-white font-medium ${
                          isDarkMode ? 'bg-purple-600 hover:bg-purple-500' : 'bg-purple-500 hover:bg-purple-600'
                        }`}>
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col overflow-y-auto">
                    <div className="p-1 flex-1">
                      {/* Role */}
                      <div className={`mb-4 px-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        <label
                          htmlFor="role"
                          className={`block text-sm font-medium ${isDarkMode ? 'text-purple-400' : 'text-purple-600'} mb-1`}>
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
                              ? 'bg-slate-800 border-purple-800 text-white placeholder-gray-400'
                              : 'bg-white border-purple-200 text-gray-800 placeholder-gray-500'
                          } focus:outline-none focus:ring-2 ${isDarkMode ? 'focus:ring-purple-500' : 'focus:ring-purple-300'}`}
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
                          className={`block text-sm font-medium ${isDarkMode ? 'text-purple-400' : 'text-purple-600'} mb-2`}>
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
                                    ? 'border-purple-700 bg-slate-700 text-purple-500'
                                    : 'border-purple-300 text-purple-600'
                                } focus:ring-2 focus:ring-purple-400`}
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
                          className={`block text-sm font-medium ${isDarkMode ? 'text-purple-400' : 'text-purple-600'} mb-2`}>
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
                                    ? 'border-purple-700 bg-slate-700 text-purple-500'
                                    : 'border-purple-300 text-purple-600'
                                } focus:ring-2 focus:ring-purple-400`}
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
                          className={`block text-sm font-medium ${isDarkMode ? 'text-purple-400' : 'text-purple-600'} mb-1`}>
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
                              ? 'bg-slate-800 border-purple-800 text-white placeholder-gray-400'
                              : 'bg-white border-purple-200 text-gray-800 placeholder-gray-500'
                          } focus:outline-none focus:ring-2 ${isDarkMode ? 'focus:ring-purple-500' : 'focus:ring-purple-300'}`}
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
                              isDarkMode
                                ? 'border-purple-700 bg-slate-700 text-purple-500'
                                : 'border-purple-300 text-purple-600'
                            } focus:ring-2 focus:ring-purple-400`}
                          />
                          <label
                            htmlFor="isRemote"
                            className={`ml-2 block text-sm font-medium ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`}>
                            Remote?
                          </label>
                        </div>
                      </div>

                      {/* Number of Applications */}
                      <div className={`mb-4 px-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                        <label
                          htmlFor="numApplications"
                          className={`block text-sm font-medium ${isDarkMode ? 'text-purple-400' : 'text-purple-600'} mb-1`}>
                          Number of Applications
                        </label>
                        <input
                          id="numApplications"
                          type="number"
                          min="1"
                          max="10"
                          value={numApplications}
                          onChange={e => setNumApplications(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                          className={`w-full px-3 py-2 rounded-md border ${
                            isDarkMode
                              ? 'bg-slate-800 border-purple-800 text-white'
                              : 'bg-white border-purple-200 text-gray-800'
                          } focus:outline-none focus:ring-2 ${isDarkMode ? 'focus:ring-purple-500' : 'focus:ring-purple-300'}`}
                        />
                        <div className="text-xs mt-1 text-gray-500">Specify how many applications to submit (1-10)</div>
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
                              ? 'bg-purple-600 hover:bg-purple-500 text-white'
                              : 'bg-purple-500 hover:bg-purple-400 text-white'
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
                            ? 'bg-purple-600 hover:bg-purple-500 text-white'
                            : 'bg-purple-500 hover:bg-purple-400 text-white'
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
                  className={`border-t ${isDarkMode ? 'border-purple-900' : 'border-purple-100'} p-2 shadow-sm backdrop-blur-sm`}>
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
