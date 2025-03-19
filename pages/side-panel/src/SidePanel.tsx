import React, { useRef, useState } from 'react';
import './SidePanel.css';

// TODO: Replace icon-32.png and icon-128.png in chrome-extension/public/ 
// with your own Job Agent icons to complete rebranding

// Hardcoded parameters for testing
const HARDCODED_API_KEY = ''; // Replace with actual API key

// Hardcoded path to resume PDF file for uploads
const PDF_RESUME_PATH = '/path/to/resume.pdf'; // Replace with actual resume PDF path

// Hardcoded resume and job preferences for job application agent
const HARDCODED_RESUME = `
{
  "name": "NISCHAY HEGDE",
  "contact": {
    "email": "nichuhegde@gmail.com",
    "phone": "8325645402"
  },
  "education": [
    {
      "institution": "Clements High School",
      "startDate": "August 2020",
      "endDate": "May 2024",
      "details": {
        "Overall GPA": "4.625",
        "SAT": "1560 (790 Math, 770 Reading)"
      }
    },
    {
      "institution": "University of Texas at Austin",
      "startDate": "August 2024",
      "endDate": "May 2027",
      "details": {
        "GPA": "3.9",
        "Major": "Electrical and Computer Engineering",
        "Expected grad date": "May 2027 due to prior credit hours"
      }
    }
  ],
  "experience": [
    {
      "company": "Road 2 Freedom",
      "position": "Coach",
      "location": "Remote",
      "startDate": "November 2024",
      "endDate": "Present",
      "responsibilities": [
        "Training 60 students in cryptocurrency trading and developing/utilizing new trading strategies including algorithmic trading.",
        "Built a tool which scans the Solana blockchain and helps students find profitable traders to tail.",
        "Personally made over a 300% return on investment using automated strategies."
      ]
    },
    {
      "company": "UT Ecocar",
      "position": "CAV team researcher",
      "location": "Austin, Texas",
      "startDate": "August 2024",
      "endDate": "Present",
      "responsibilities": [
        "Working in a team of 3 to develop a machine learning algorithm for positioning a self-driving car.",
        "Utilized MATLAB and Simulink to build, test, and visualize 2 variations of neural network architectures to predict steering and acceleration torques for the car.",
        "Documenting our methods in order to write a research paper in the future.",
        "Connecting the algorithm to RTMAPS and performing safe and controlled test drives of the physical car."
      ]
    },
    {
      "company": "UT HRCL (Human Centered Robotics Laboratory)",
      "position": "Researcher",
      "location": "Austin, Texas",
      "startDate": "October 2024",
      "endDate": "Present",
      "responsibilities": [
        "Working in the HRCL lab under PHD researcher Dongho Kang to manufacture a robotic arm and hand.",
        "Utilizing Kicad to design the main PCB board for the robotic hand keeping in mind size constraints and power requirements.",
        "Soldering components onto the PCB board so that wires do not hinder the motion of the robotic hand."
      ]
    },
    {
      "company": "Gameplan Academy",
      "position": "Math & Science Tutor",
      "location": "Sugar Land, Texas",
      "startDate": "August 2023",
      "endDate": "July 2024",
      "responsibilities": [
        "Delivered tailored tutoring sessions to 9th-11th graders in AP and honors subjects including physics and computer science.",
        "On average, students had an 11-point increase in class grade by attending sessions."
      ]
    }
  ],
  "leadershipExperience": [
    {
      "role": "Internet & Technology Officer",
      "organization": "Clements Habitat for Humanity",
      "years": "2021 - 2024"
    },
    {
      "role": "VEX Robotics Team Member",
      "organization": "Clements High School TSA",
      "years": "2021 - 2024"
    },
    {
      "role": "Team Captain",
      "organization": "Clements High School Track & Field",
      "years": "2020 - 2024"
    }
  ],
  "academicAwards": [
    "USACO Silver Division Competitor",
    "AP Scholar With Distinction",
    "National Merit Finalist"
  ],
  "skills": {
    "Communication": "Can effectively communicate technical and non-technical ideas to people of all backgrounds.",
    "Teamwork": "Utilizes the fact that everyone in a team has an important role to play and that individual skills can complement each other to great effect.",
    "Coding": "Multiple years of experience in Python, Java, C++, Javascript, Matlab. Sufficient knowledge in data processing and machine learning frameworks.",
    "Engineering Design": "Great at constructing efficient and clever solutions to engineering problems. Experience innovating with limited resources to achieve exemplary outcomes."
  }
}
`;

const HARDCODED_JOB_PREFERENCES = `
Quantitative analyst position at a hedge fund or investment bank.
`;

// General task for job application
const JOB_SEARCH_TASK = "Search for and apply to jobs that match my job preferences only, regardless of my resume background";

const SidePanel = () => {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [agentMessages, setAgentMessages] = useState<Array<{content: string, timestamp: number}>>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [targetAppCount, setTargetAppCount] = useState(5); // Default to 5 applications
  const [appliedJobs, setAppliedJobs] = useState<Array<any>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages arrive
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentMessages]);

  // Load applied jobs on component mount
  React.useEffect(() => {
    const loadAppliedJobs = async () => {
      try {
        const result = await chrome.storage.local.get('jobagent_applications');
        const jobs = result['jobagent_applications'] || [];
        setAppliedJobs(jobs);
      } catch (error) {
        console.error('Failed to load applied jobs:', error);
      }
    };
    
    loadAppliedJobs();
    
    // Set up a listener for storage changes to update the UI in real-time
    const storageListener = (changes: any) => {
      if (changes['jobagent_applications']) {
        setAppliedJobs(changes['jobagent_applications'].newValue || []);
      }
    };
    
    chrome.storage.onChanged.addListener(storageListener);
    
    return () => {
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, []);

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
              content: `Task failed. Reason: ${message.data?.details || 'Unknown error'}`,
              timestamp: message.timestamp
            }]);
            setIsRunning(false);
          } else if (message.type === 'execution' && message.state === 'task_cancel') {
            setAgentMessages(prev => [...prev, {
              content: 'Task cancelled by user.',
              timestamp: message.timestamp || Date.now()
            }]);
            setIsRunning(false);
          } else {
            // Log any other messages for debugging
            console.log('Unhandled message:', message);
            if (message.type && message.type !== 'heartbeat' && message.type !== 'heartbeat_ack') {
              setAgentMessages(prev => [...prev, {
                content: `Debug - Received message: ${JSON.stringify(message, null, 2)}`,
                timestamp: Date.now()
              }]);
            }
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
        content: `Starting job search based ONLY on job preferences:`,
        timestamp: Date.now()
      }]);
      
      setAgentMessages(prev => [...prev, {
        content: `Job Preferences: "${HARDCODED_JOB_PREFERENCES.trim()}"`,
        timestamp: Date.now()
      }]);
      
      setAgentMessages(prev => [...prev, {
        content: `Target: ${targetAppCount} job applications`,
        timestamp: Date.now()
      }]);
      
      setAgentMessages(prev => [...prev, {
        content: `Resume PDF Path: "${PDF_RESUME_PATH}" will be used for resume upload requests`,
        timestamp: Date.now()
      }]);
      
      setAgentMessages(prev => [...prev, {
        content: `Note: The agent will IGNORE your resume background when searching for jobs, and will ONLY use your resume when filling out application forms.`,
        timestamp: Date.now()
      }]);
      
      setAgentMessages(prev => [...prev, {
        content: `Tip: The agent will continue running even after reaching the target number of applications. You can manually stop it at any time by clicking the "Stop Agent" button.`,
        timestamp: Date.now()
      }]);
      
      // Send the message to the background script with resume and job preferences
      portRef.current.postMessage({
        type: 'new_task',
        task: JOB_SEARCH_TASK,
        taskId: taskId,
        tabId: tabId,
        apiKey: HARDCODED_API_KEY,
        modelName: 'o3-mini',
        providerName: 'openai',
        // Include resume and job preferences as extra args
        extraArgs: {
          resume: HARDCODED_RESUME,
          jobPreferences: HARDCODED_JOB_PREFERENCES,
          targetApplicationCount: targetAppCount,
          resumePdfPath: PDF_RESUME_PATH
        }
      });
      
      console.log('Task sent with resume and job preferences');
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

  const clearApplicationHistory = async () => {
    try {
      await chrome.storage.local.remove('jobagent_applications');
      setAppliedJobs([]);
      setAgentMessages(prev => [...prev, {
        content: 'Application history cleared.',
        timestamp: Date.now()
      }]);
    } catch (error) {
      console.error('Failed to clear application history:', error);
      setAgentMessages(prev => [...prev, {
        content: `Error clearing history: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now()
      }]);
    }
  };

  // Calculate current session applications
  const getCurrentSessionApps = () => {
    const currentSession = Date.now();
    const sessionStartTime = currentSession - (60 * 60 * 1000); // Approximate session start time (1 hour ago)
    return appliedJobs.filter(job => new Date(job.date_applied).getTime() > sessionStartTime).length;
  };

  return (
    <div className="simple-panel">
      <h2 className="panel-title">Job Application Agent</h2>
      
      <div className="job-preferences">
        <strong>Job Preferences:</strong>
        <p>{HARDCODED_JOB_PREFERENCES.substring(0, 150)}...</p>
      </div>
      
      <div className="resume-preview">
        <strong>Resume Preview:</strong>
        <p>{HARDCODED_RESUME.substring(0, 100)}...</p>
        <p><em>(Full resume will be used for job applications)</em></p>
      </div>
      
      <div className="target-apps-container">
        <label htmlFor="targetApps">Target Applications:</label>
        <input 
          type="number" 
          id="targetApps" 
          min="1" 
          max="50" 
          value={targetAppCount} 
          onChange={(e) => setTargetAppCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
          disabled={isRunning}
        />
      </div>
      
      <div className="application-history">
        <h3>Application History ({appliedJobs.length})</h3>
        
        {isRunning && (
          <div className="application-progress">
            <div className="progress-label">
              Current Session Progress: {getCurrentSessionApps()}/{targetAppCount}
            </div>
            <div className="progress-bar-container">
              <div 
                className="progress-bar" 
                style={{ 
                  width: `${Math.min(100, (getCurrentSessionApps() / targetAppCount) * 100)}%` 
                }}
              />
            </div>
          </div>
        )}
        
        {appliedJobs.length > 0 ? (
          <>
            <div className="applied-job-list">
              {appliedJobs.slice(0, 5).map((job, index) => (
                <div key={job.id || index} className="applied-job-item">
                  <div>
                    <strong>{job.position}</strong> at {job.company}
                  </div>
                  <div className="job-date">
                    Applied: {new Date(job.date_applied).toLocaleDateString()}
                  </div>
                </div>
              ))}
              {appliedJobs.length > 5 && (
                <div className="more-jobs">
                  +{appliedJobs.length - 5} more jobs
                </div>
              )}
            </div>
            <button 
              onClick={clearApplicationHistory} 
              className="clear-history-button"
              disabled={isRunning}>
              Clear History
            </button>
          </>
        ) : (
          <p>No applications submitted yet.</p>
        )}
      </div>
      
      <div className="button-container">
        <button 
          onClick={runAgent}
          className="run-button"
          disabled={isRunning}>
          {isRunning ? 'Running...' : 'Start Job Search'}
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
            The job application agent will search for jobs matching your job preferences, regardless of your resume background. Your resume will only be used to fill out application forms.
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
