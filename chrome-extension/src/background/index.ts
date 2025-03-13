import 'webextension-polyfill';
import { agentModelStore, AgentNameEnum, generalSettingsStore, llmProviderStore } from '@extension/storage';
import BrowserContext from './browser/context';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;
// Store for resume data and job keywords
let resumeData = null;
let jobKeywords = null;

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

// Function to check if script is already injected
async function isScriptInjected(tabId: number): Promise<boolean> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        Object.prototype.hasOwnProperty.call(window, 'buildDomTree') &&
        Object.prototype.hasOwnProperty.call(window, 'parserReadability'),
    });
    return results[0]?.result || false;
  } catch (err) {
    console.error('Failed to check script injection status:', err);
    return false;
  }
}

// Function to inject the DOM scripts
async function injectBuildDomTree(tabId: number) {
  try {
    // Check if already injected
    const alreadyInjected = await isScriptInjected(tabId);
    if (alreadyInjected) {
      console.log('Scripts already injected, skipping...');
      return;
    }

    // First inject the readability parser
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['parserReadability.js'],
    });

    // Then inject the DOM tree builder
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['buildDomTree.js'],
    });

    console.log('Scripts successfully injected');
  } catch (err) {
    console.error('Failed to inject scripts:', err);
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    await injectBuildDomTree(tabId);
  }
});

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener(async (source, reason) => {
  console.log('Debugger detached:', source, reason);
  if (reason === 'canceled_by_user') {
    if (source.tabId) {
      await browserContext.cleanup();
    }
  }
});

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  browserContext.removeAttachedPage(tabId);
});

logger.info('background loaded');

// Setup connection listener
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'side-panel-connection') {
    currentPort = port;

    port.onMessage.addListener(async message => {
      try {
        switch (message.type) {
          case 'heartbeat':
            // Acknowledge heartbeat
            port.postMessage({ type: 'heartbeat_ack' });
            break;

          case 'new_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: 'No task provided' });
            if (!message.tabId) return port.postMessage({ type: 'error', error: 'No tab ID provided' });

            logger.info('new_task', message.tabId, message.task);

            // Parse resume and keywords from task if available
            if (message.resumeData) {
              resumeData = message.resumeData;
              logger.info('Resume data received');
            }

            if (message.jobKeywords) {
              jobKeywords = message.jobKeywords;
              logger.info('Job keywords received:', jobKeywords);
            }

            // Enhance task with resume and keywords if available
            let enhancedTask = message.task;
            if (resumeData || jobKeywords) {
              enhancedTask = formatJobApplicationTask(message.task, resumeData, jobKeywords);
            }

            currentExecutor = await setupExecutor(message.taskId, enhancedTask, browserContext);
            subscribeToExecutorEvents(currentExecutor);

            const result = await currentExecutor.execute();
            logger.info('new_task execution result', message.tabId, result);
            break;
          }

          case 'update_resume': {
            resumeData = message.resumeData;
            logger.info('Resume data updated');
            port.postMessage({ type: 'resume_updated' });
            break;
          }

          case 'update_keywords': {
            jobKeywords = message.jobKeywords;
            logger.info('Job keywords updated:', jobKeywords);
            port.postMessage({ type: 'keywords_updated' });
            break;
          }

          case 'clear_resume': {
            resumeData = null;
            logger.info('Resume data cleared');
            port.postMessage({ type: 'resume_cleared' });
            break;
          }

          case 'follow_up_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: 'No follow up task provided' });
            if (!message.tabId) return port.postMessage({ type: 'error', error: 'No tab ID provided' });

            logger.info('follow_up_task', message.tabId, message.task);

            // If executor exists, add follow-up task
            if (currentExecutor) {
              currentExecutor.addFollowUpTask(message.task);
              // Re-subscribe to events in case the previous subscription was cleaned up
              subscribeToExecutorEvents(currentExecutor);
              const result = await currentExecutor.execute();
              logger.info('follow_up_task execution result', message.tabId, result);
            } else {
              // executor was cleaned up, can not add follow-up task
              logger.info('follow_up_task: executor was cleaned up, can not add follow-up task');
              return port.postMessage({ type: 'error', error: 'Executor was cleaned up, can not add follow-up task' });
            }
            break;
          }

          case 'cancel_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: 'No task to cancel' });
            await currentExecutor.cancel();
            break;
          }

          case 'screenshot': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: 'No tab ID provided' });
            const page = await browserContext.switchTab(message.tabId);
            const screenshot = await page.takeScreenshot();
            logger.info('screenshot', message.tabId, screenshot);
            return port.postMessage({ type: 'success', screenshot });
          }

          case 'resume_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: 'No task to resume' });
            await currentExecutor.resume();
            return port.postMessage({ type: 'success' });
          }

          case 'pause_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: 'No task to pause' });
            await currentExecutor.pause();
            return port.postMessage({ type: 'success' });
          }
          default:
            return port.postMessage({ type: 'error', error: 'Unknown message type' });
        }
      } catch (error) {
        console.error('Error handling port message:', error);
        port.postMessage({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('Side panel disconnected');
      currentPort = null;
    });
  }
});

// Function to format the job application task with resume and keywords
function formatJobApplicationTask(task: string, resumeData: any, jobKeywords: string[]): string {
  let enhancedTask = task;

  if (resumeData) {
    // For PDF resumes, use the extracted text data
    if (resumeData.resumeText) {
      enhancedTask += `\n\nRESUME DATA:\n${resumeData.resumeText}`;

      // Add a note that this is a text-only representation
      if (resumeData.originalFormat === 'PDF') {
        enhancedTask += '\n(Note: This is a text-only representation of the PDF resume)';
      }
    } else {
      // For non-PDF data, stringify the object
      enhancedTask += `\n\nRESUME DATA:\n${JSON.stringify(resumeData, null, 2)}`;
    }
  }

  if (jobKeywords && jobKeywords.length > 0) {
    enhancedTask += `\n\nJOB KEYWORDS: ${jobKeywords.join(', ')}`;
  }

  // Add instructions for handling resume data in job applications
  enhancedTask += `\n\nIMPORTANT INSTRUCTIONS:
1. Use ONLY the information from the resume to fill out job applications
2. Do not fabricate any information not present in the resume
3. If required fields are missing from the resume, notify the user
4. For login/signup screens, use Google Sign-in when available`;

  return enhancedTask;
}

async function setupExecutor(taskId: string, task: string, browserContext: BrowserContext) {
  const providers = await llmProviderStore.getAllProviders();
  // if no providers, need to display the options page
  if (Object.keys(providers).length === 0) {
    throw new Error('Please configure API keys in the settings first');
  }
  const agentModels = await agentModelStore.getAllAgentModels();
  // verify if every provider used in the agent models exists in the providers
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) {
      throw new Error(`Provider ${agentModel.provider} not found in the settings`);
    }
  }

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new Error('Please choose a model for the navigator in the settings first');
  }
  const navigatorLLM = createChatModel(
    AgentNameEnum.Navigator,
    navigatorModel.provider,
    providers[navigatorModel.provider],
    navigatorModel.modelName,
  );

  let plannerLLM = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    plannerLLM = createChatModel(
      AgentNameEnum.Planner,
      plannerModel.provider,
      providers[plannerModel.provider],
      plannerModel.modelName,
    );
  }

  let validatorLLM = null;
  const validatorModel = agentModels[AgentNameEnum.Validator];
  if (validatorModel) {
    validatorLLM = createChatModel(
      AgentNameEnum.Validator,
      validatorModel.provider,
      providers[validatorModel.provider],
      validatorModel.modelName,
    );
  }

  const generalSettings = await generalSettingsStore.getSettings();
  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    validatorLLM: validatorLLM ?? navigatorLLM,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: generalSettings.useVisionForPlanner,
      planningInterval: generalSettings.planningInterval,
    },
  });

  return executor;
}

// Update subscribeToExecutorEvents to use port
async function subscribeToExecutorEvents(executor: Executor) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    try {
      if (currentPort) {
        currentPort.postMessage(event);
      }
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      await currentExecutor?.cleanup();
    }
  });
}
