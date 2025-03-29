import { ActionResult } from '../types';
import { searchLinkedInActionSchema } from './schemas';
import { Action } from './builder';
import { Actors, ExecutionState } from '../event/types';
import { createLogger } from '@src/background/log';

const logger = createLogger('LinkedInAction');

export function createLinkedInSearchAction(context: any): Action {
  return new Action(async (input: { query: string }) => {
    const searchQuery = input.query || 'jobs'; // Default to "jobs" if no query provided
    const msg = `Searching for "${searchQuery}" on LinkedIn`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

    // Parse the query to see if there's a job title and location
    // Format could be something like "software engineer in San Francisco" or just "software engineer"
    const locationMatch = searchQuery.match(/\s+in\s+([^,]+)/i);
    const location = locationMatch ? locationMatch[1].trim() : '';

    // Remove the location part from the query to get the job title
    const jobTitle = locationMatch ? searchQuery.replace(locationMatch[0], '').trim() : searchQuery;

    const page = await context.browserContext.getCurrentPage();

    // If we have both job title and location
    if (location) {
      await page.navigateTo(
        `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(jobTitle)}&location=${encodeURIComponent(location)}&origin=SWITCH_SEARCH_VERTICAL`,
      );
    } else {
      // If we only have job title
      await page.navigateTo(
        `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(jobTitle)}&origin=SWITCH_SEARCH_VERTICAL`,
      );
    }

    const msg2 = location
      ? `Searched for "${jobTitle}" in "${location}" on LinkedIn`
      : `Searched for "${jobTitle}" on LinkedIn`;

    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
    return new ActionResult({
      extractedContent: msg2,
      includeInMemory: true,
    });
  }, searchLinkedInActionSchema);
}
