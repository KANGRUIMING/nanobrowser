import { ActionResult } from '../types';
import { searchLinkedInActionSchema } from './schemas';
import { Action } from './builder';
import { Actors, ExecutionState } from '../event/types';
import { createLogger } from '@src/background/log';

const logger = createLogger('LinkedInAction');

export function createLinkedInSearchAction(context: any): Action {
  return new Action(
    async (input: {
      query: string;
      location?: string;
      experienceLevel?: string;
      jobType?: string;
      salary?: string;
      companyId?: string;
    }) => {
      // Build the LinkedIn URL with parameters
      const keywords = encodeURIComponent(input.query || 'jobs');
      const location = input.location ? `&location=${encodeURIComponent(input.location)}` : '';

      // Map experience level from text to LinkedIn's numeric codes
      let expLevel = '';
      if (input.experienceLevel) {
        const expMap: { [key: string]: string } = {
          'entry level': '1',
          associate: '2',
          'mid-senior level': '3',
          director: '4',
          executive: '5',
        };
        const level = expMap[input.experienceLevel.toLowerCase()];
        if (level) expLevel = `&f_E=${level}`;
      }

      // Map job type to LinkedIn's format
      let jobType = '';
      if (input.jobType) {
        const jobMap: { [key: string]: string } = {
          'full-time': 'FULLTIME',
          'part-time': 'PARTTIME',
          contract: 'CONTRACT',
          internship: 'INTERNSHIP',
          temporary: 'TEMPORARY',
        };
        const type = jobMap[input.jobType.toLowerCase()];
        if (type) jobType = `&f_JT=${type}`;
      }

      // Add salary filter if provided
      const salary = input.salary ? `&f_SALARY=${input.salary}` : '';

      // Add company ID if provided
      const companyId = input.companyId ? `&f_C=${input.companyId}` : '';

      // Construct the full URL
      const linkedInUrl = `https://www.linkedin.com/jobs/search/?keywords=${keywords}${location}${expLevel}${jobType}${salary}${companyId}`;

      const msg = `Navigating to LinkedIn job search for "${input.query}"`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

      const page = await context.browserContext.getCurrentPage();
      await page.navigateTo(linkedInUrl);

      const msg2 = `Successfully navigated to LinkedIn job search with parameters: keywords=${input.query}${location ? ', location=' + input.location : ''}${expLevel ? ', experience level=' + input.experienceLevel : ''}${jobType ? ', job type=' + input.jobType : ''}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);

      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    },
    searchLinkedInActionSchema,
  );
}
