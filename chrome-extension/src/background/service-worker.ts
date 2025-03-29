import { createLinkedInSearchUrl } from './linkedin-search';

// Add a handler for direct LinkedIn search messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'direct_linkedin_search') {
    handleDirectLinkedInSearch(message.params, message.tabId).catch(err => {
      console.error('Failed to navigate to LinkedIn search:', err);
    });
    return true; // Indicate we'll handle this asynchronously
  }

  // ... other message handlers ...
});

async function handleDirectLinkedInSearch(
  params: {
    query: string;
    location?: string;
    experienceLevel?: string;
    jobType?: string;
    datePosted?: string;
    remoteOption?: boolean;
  },
  tabId: number,
) {
  // Generate the LinkedIn search URL
  const linkedInUrl = createLinkedInSearchUrl(params);

  // Open the LinkedIn search URL in a new tab
  await chrome.tabs.create({ url: linkedInUrl });

  console.log(`Opened LinkedIn search in new tab: ${linkedInUrl}`);
}
