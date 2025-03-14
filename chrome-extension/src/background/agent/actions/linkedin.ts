import { ActionResult } from '../types';
import { searchLinkedInActionSchema } from './schemas';
import { Action } from './builder';
import { Actors, ExecutionState } from '../event/types';
import { createLogger } from '@src/background/log';

const logger = createLogger('LinkedInAction');

export function createLinkedInSearchAction(context: any): Action {
  return new Action(async (input: { query: string }) => {
    // Extract job title if the query starts with "Using job title"
    let searchQuery = input.query;
    if (searchQuery.startsWith('Using job title')) {
      const match = searchQuery.match(/Using job title "([^"]+)": (.+)/);
      if (match) {
        searchQuery = match[1]; // Use the job title as the search query
      }
    }

    const msg = `Searching for "${searchQuery}" on LinkedIn`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

    const page = await context.browserContext.getCurrentPage();
    await page.navigateTo(`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(searchQuery)}`);

    const msg2 = `Searched for "${searchQuery}" on LinkedIn`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
    return new ActionResult({
      extractedContent: msg2,
      includeInMemory: true,
    });
  }, searchLinkedInActionSchema);
}
