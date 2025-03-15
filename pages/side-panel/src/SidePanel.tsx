import React, { useRef, useState } from 'react';
import './SidePanel.css';

// Hardcoded parameters for testing
const HARDCODED_API_KEY = 'your-openai-api-key-here'; // Replace with actual API key
const HARDCODED_TASK = 'Search for information about artificial intelligence and summarize the top 3 results';

const SidePanel = () => {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [agentMessages, setAgentMessages] = useState<Array<{content: string, timestamp: number}>>([]);
  const [isRunning, setIsRunning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages arrive
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentMessages]);

  const runAgent = async () => {
    try {
      // Clear previous messages
      setAgentMessages([]);
      setIsRunning(true);
      
      // Get the active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        console.error('No active tab found');
        setAgentMessages(prev => [...prev, {
          content: 'Error: No active tab found. Please open a webpage to use the agent.',
          timestamp: Date.now()
        }]);
        setIsRunning(false);
        return;
      }

      // Set up connection to background script if not exists
      if (!portRef.current) {
        portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });
        
        portRef.current.onMessage.addListener((message) => {
          console.log('Message received:', message);
          
          // Display agent messages
          if (message.type === 'execution' && message.data?.details) {
            setAgentMessages(prev => [...prev, {
              content: `${message.actor}: ${message.data.details}`,
              timestamp: message.timestamp
            }]);
          } else if (message.type === 'error') {
            setAgentMessages(prev => [...prev, {
              content: `Error: ${message.error || 'Unknown error occurred'}`,
              timestamp: Date.now()
            }]);
            setIsRunning(false);
          } else if (message.type === 'execution' && message.state === 'task_ok') {
            setAgentMessages(prev => [...prev, {
              content: 'Task completed successfully!',
              timestamp: message.timestamp
            }]);
            setIsRunning(false);
          } else if (message.type === 'execution' && message.state === 'task_fail') {
            setAgentMessages(prev => [...prev, {
              content: 'Task failed.',
              timestamp: message.timestamp
            }]);
            setIsRunning(false);
          } else if (message.type === 'execution' && message.state === 'task_cancel') {
            setAgentMessages(prev => [...prev, {
              content: 'Task cancelled by user.',
              timestamp: message.timestamp || Date.now()
            }]);
            setIsRunning(false);
          }
        });
        
        portRef.current.onDisconnect.addListener(() => {
          console.log('Connection disconnected');
          portRef.current = null;
          setIsRunning(false);
        });
      }

      // Generate a simple task ID
      const taskId = `task-${Date.now()}`;
      
      // Add initial message
      setAgentMessages(prev => [...prev, {
        content: `Starting task: ${HARDCODED_TASK}`,
        timestamp: Date.now()
      }]);
      
      // Send the message to the background script
      portRef.current.postMessage({
        type: 'new_task',
        task: HARDCODED_TASK,
        taskId: taskId,
        tabId: tabId,
        apiKey: HARDCODED_API_KEY,
        modelName: 'gpt-3.5-turbo',
        providerName: 'openai'
      });
      
      console.log('Task sent:', HARDCODED_TASK);
    } catch (err) {
      console.error('Error running agent:', err);
      setAgentMessages(prev => [...prev, {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now()
      }]);
      setIsRunning(false);
    }
  };

  const stopAgent = () => {
    if (portRef.current && isRunning) {
      // Add message indicating stopping attempt
      setAgentMessages(prev => [...prev, {
        content: 'Attempting to stop the agent...',
        timestamp: Date.now()
      }]);
      
      // Send cancel message to background script
      portRef.current.postMessage({
        type: 'cancel_task'
      });
      
      console.log('Stop request sent');
    }
  };

  return (
    <div className="simple-panel">
      <div className="button-container">
        <button 
          onClick={runAgent}
          className="run-button"
          disabled={isRunning}>
          {isRunning ? 'Running...' : 'Run Agent'}
        </button>
        
        {isRunning && (
          <button 
            onClick={stopAgent}
            className="stop-button">
            Stop Agent
          </button>
        )}
      </div>
      
      <div className="messages-container">
        {agentMessages.length === 0 ? (
          <div className="empty-state">
            Agent output will appear here.
          </div>
        ) : (
          agentMessages.map((msg, index) => (
            <div key={index} className="message">
              <div className="message-content">{msg.content}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default SidePanel;
