import { ActionResult } from '../types';
import { searchLinkedInActionSchema } from './schemas';
import { Action } from './builder';
import { Actors, ExecutionState } from '../event/types';
import { createLogger } from '@src/background/log';

const logger = createLogger('LinkedInAction');

export function createLinkedInSearchAction(context: any): Action {
  return new Action(async (input: { query: string }) => {
    const searchQuery = input.query;
    const msg = `Searching for "${searchQuery}" on LinkedIn`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

    const page = await context.browserContext.getCurrentPage();
    await page.navigateTo(
      `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(searchQuery)}&origin=SWITCH_SEARCH_VERTICAL`,
    );

    const msg2 = `Searched for "${searchQuery}" on LinkedIn`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
    return new ActionResult({
      extractedContent: msg2,
      includeInMemory: true,
    });
  }, searchLinkedInActionSchema);
}
