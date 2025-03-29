import { createLinkedInSearchUrl } from './linkedin-search';
import 'webextension-polyfill';
import { agentModelStore, AgentNameEnum, generalSettingsStore, llmProviderStore } from '@extension/storage';
import BrowserContext from './browser/context';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

// Function to check if script is already injected
async function isScriptInjected(tabId: number): Promise<boolean> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Object.prototype.hasOwnProperty.call(window, 'buildDomTree'),
    });
    return results[0]?.result || false;
  } catch (err) {
    console.error('Failed to check script injection status:', err);
    return false;
  }
}

// // Function to inject the buildDomTree script
async function injectBuildDomTree(tabId: number) {
  try {
    // Check if already injected
    const alreadyInjected = await isScriptInjected(tabId);
    if (alreadyInjected) {
      console.log('Scripts already injected, skipping...');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['buildDomTree.js'],
    });
    console.log('Scripts successfully injected');
  } catch (err) {
    console.error('Failed to inject scripts:', err);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('linkedin.com')) {
    // Initialize agent and functionality
    injectBuildDomTree(tabId);
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
            currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
            subscribeToExecutorEvents(currentExecutor);

            const result = await currentExecutor.execute();
            logger.info('new_task execution result', message.tabId, result);
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
  const navigatorLLM = createChatModel(providers[navigatorModel.provider], navigatorModel);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    plannerLLM = createChatModel(providers[plannerModel.provider], plannerModel);
  }

  let validatorLLM: BaseChatModel | null = null;
  const validatorModel = agentModels[AgentNameEnum.Validator];
  if (validatorModel) {
    validatorLLM = createChatModel(providers[validatorModel.provider], validatorModel);
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

// Add or ensure this code exists in your background script entry point
chrome.runtime.onInstalled.addListener(() => {
  console.log('LinkedIn extension installed/updated');
});

// Make sure the runtime message listener is set up properly
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message in background:', message.type);

  if (message.type === 'direct_linkedin_search') {
    handleDirectLinkedInSearch(message.params).catch(err => {
      console.error('Failed to navigate to LinkedIn search:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Indicate we'll handle this asynchronously
  }

  // Other message handlers...
  return false;
});

async function handleDirectLinkedInSearch(params) {
  // Build the LinkedIn URL with parameters
  const keywords = encodeURIComponent(params.query || 'jobs');
  const location = params.location ? `&location=${encodeURIComponent(params.location)}` : '';

  // Properly handle experience level
  // Only set it if the user specifically requested an experience level
  let expLevel = '';
  if (params.experienceLevel) {
    if (params.experienceLevel.toLowerCase() === 'internship') {
      expLevel = '&f_E=1';
    } else if (params.experienceLevel.toLowerCase() === 'full-time') {
      // For full-time positions, include associate through executive levels (2-6)
      expLevel = '&f_E=2,3,4,5,6';
    } else if (params.experienceLevel.toLowerCase() === 'entry level') {
      expLevel = '&f_E=1';
    } else if (params.experienceLevel.toLowerCase() === 'associate') {
      expLevel = '&f_E=2';
    } else if (params.experienceLevel.toLowerCase() === 'mid-senior level') {
      expLevel = '&f_E=3';
    } else if (params.experienceLevel.toLowerCase() === 'director') {
      expLevel = '&f_E=4';
    } else if (params.experienceLevel.toLowerCase() === 'executive') {
      expLevel = '&f_E=5';
    }
  }

  // Handle job type separately from experience level
  const jobType =
    params.jobType?.toLowerCase() === 'full-time'
      ? '&f_JT=FULLTIME'
      : params.jobType?.toLowerCase() === 'part-time'
        ? '&f_JT=PARTTIME'
        : params.jobType?.toLowerCase() === 'contract'
          ? '&f_JT=CONTRACT'
          : params.jobType?.toLowerCase() === 'internship'
            ? '&f_JT=INTERNSHIP'
            : params.jobType?.toLowerCase() === 'temporary'
              ? '&f_JT=TEMPORARY'
              : '';

  const datePosted =
    params.datePosted === 'past_24h'
      ? '&f_TPR=r86400'
      : params.datePosted === 'past_week'
        ? '&f_TPR=r604800'
        : params.datePosted === 'past_month'
          ? '&f_TPR=r2592000'
          : '';

  const remote = params.remoteOption ? '&f_WT=2' : '';

  // Add Easy Apply filter
  const easyApply = params.easyApplyOnly ? '&f_LF=f_AL' : '';

  // Construct the full URL
  const linkedInUrl = `https://www.linkedin.com/jobs/search/?keywords=${keywords}${location}${expLevel}${jobType}${datePosted}${remote}${easyApply}`;

  // Check for existing LinkedIn job search tabs
  const tabs = await chrome.tabs.query({});
  const linkedInJobTab = tabs.find(tab => tab.url?.includes('linkedin.com/jobs/search'));

  if (linkedInJobTab && linkedInJobTab.id) {
    // Update the existing tab instead of creating a new one
    await chrome.tabs.update(linkedInJobTab.id, {
      url: linkedInUrl,
      active: true, // Focus this tab
    });
    console.log(`Updated existing LinkedIn job search tab: ${linkedInUrl}`);
  } else {
    // If no LinkedIn job tab exists, create a new one
    await chrome.tabs.create({ url: linkedInUrl });
    console.log(`Opened LinkedIn search in new tab: ${linkedInUrl}`);
  }
}

// Add this function definition if the import isn't working
function createLinkedInSearchUrl(params: any): string {
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
      // Special case for full-time experience levels - now including level 2 (Associate)
      'full-time': '2,3,4,5,6', // Include multiple experience levels
      internship: '1',
    };
    const level = expMap[params.experienceLevel.toLowerCase()];
    if (level) expLevel = `&f_E=${level}`;
  }

  // Map job type to LinkedIn's format - separate from experience level
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

  // Construct the full URL
  const linkedInUrl = `https://www.linkedin.com/jobs/search/?keywords=${keywords}${location}${expLevel}${jobType}${datePosted}${easyApply}`;

  return linkedInUrl;
}
