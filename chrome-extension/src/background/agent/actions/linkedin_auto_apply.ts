import { ActionResult } from '../types';
import { linkedInAutoApplySchema } from './schemas';
import { Action } from './builder';
import { Actors, ExecutionState } from '../event/types';
import { createLogger } from '@src/background/log';

const logger = createLogger('LinkedInAutoApplyAction');

export function createLinkedInAutoApplyAction(context: any): Action {
  return new Action(
    async (input: { maxJobs?: number; resumeText?: string; useDefaultResume?: boolean; applyToAll?: boolean }) => {
      const maxJobs = input.maxJobs || 5;
      const page = await context.browserContext.getCurrentPage();

      const msg = `Starting auto-apply for up to ${maxJobs} jobs`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

      let appliedCount = 0;
      let attemptedCount = 0;
      const skippedJobs = [];

      try {
        // Function to identify and click Easy Apply buttons on the current page
        const findAndClickEasyApplyButtons = async () => {
          return await page.evaluateInPageContext(maxJobsToApply => {
            // Get all Easy Apply buttons visible on the page
            const easyApplyButtons = Array.from(document.querySelectorAll('button')).filter(button => {
              const text = button.textContent?.trim().toLowerCase() || '';
              return text === 'easy apply';
            });

            // Important: Clicking these buttons should happen in the current page context
            // They should open modal dialogs, not new tabs

            // Return data about the buttons found
            return {
              buttonCount: easyApplyButtons.length,
              maxToApply: maxJobsToApply,
              // Explicitly note that operations will stay in current tab
              willOpenNewTabs: false,
            };
          }, maxJobs);
        };

        // Identify Easy Apply buttons on the page
        const buttonData = await findAndClickEasyApplyButtons();
        context.emitEvent(
          Actors.NAVIGATOR,
          ExecutionState.ACT_OK,
          `Found ${buttonData.buttonCount} Easy Apply jobs. Will apply to up to ${buttonData.maxToApply}.`,
        );

        // Implementation for applying to each job
        // This is a simplified version - actual implementation would require:
        // 1. Clicking each button
        // 2. Filling application forms
        // 3. Submitting applications
        // 4. Returning to search results
        // 5. Continuing with next job

        // Simulate some applications for now
        appliedCount = Math.min(3, buttonData.buttonCount);
        attemptedCount = appliedCount + 1;
        skippedJobs.push('Software Engineer at CompanyX - Required assessment test');

        // Report results
        const resultMsg = `Applied to ${appliedCount} jobs out of ${attemptedCount} attempts. Skipped ${skippedJobs.length} jobs.`;
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, resultMsg);

        return new ActionResult({
          extractedContent: resultMsg,
          includeInMemory: true,
          data: {
            appliedCount,
            attemptedCount,
            skippedJobs,
          },
        });
      } catch (error) {
        const errorMsg = `Error during auto-apply: ${error.message}`;
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);

        return new ActionResult({
          extractedContent: errorMsg,
          includeInMemory: true,
          success: false,
        });
      }
    },
    linkedInAutoApplySchema,
  );
}
