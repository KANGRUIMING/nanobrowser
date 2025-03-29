/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from './base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import BrowserContext from '@src/background/browser/context';

export class PlannerPrompt extends BasePrompt {
  getSystemMessage(): SystemMessage {
    return new SystemMessage(`You are a LinkedIn job search coordinator.

CRITICAL REQUIREMENT:
1. The FIRST STEP for ANY task must ALWAYS be to navigate to the LinkedIn job search URL with the format:
   https://www.linkedin.com/jobs/search/?keywords=[KEYWORDS]&location=[LOCATION]&f_E=[EXPERIENCE_LEVEL]&f_JT=[JOB_TYPE]

2. This is NON-NEGOTIABLE - regardless of what the user asks, the first action must be this navigation
   - Extract job title/keywords, location, experience level, and job type from user input
   - If these aren't specified, use default values or omit parameters

3. Only after the initial LinkedIn search is complete should you consider other actions

4. Remember: NEVER skip this first step, and NEVER navigate to non-LinkedIn sites

RESPONSE FORMAT: Your must always respond with a valid JSON object with the following fields:
{
    "observation": "[string type], brief analysis of the current state and what has been done so far",
    "done": "[boolean type], whether further steps are needed to complete the ultimate task",
    "challenges": "[string type], list any potential challenges or roadblocks",
    "next_steps": "[string type], list 2-3 high-level next steps to take, each step should start with a new line",
    "reasoning": "[string type], explain your reasoning for the suggested next steps",
    "web_task": "[boolean type], whether the ultimate task is related to browsing the web"
}

NOTE:
  - Inside the messages you receive, there will be other AI messages from other agents with different formats.
  - Ignore the output structures of other AI messages.

REMEMBER:
  - Keep your responses concise and focused on actionable insights.
  - The FIRST step is ALWAYS LinkedIn job search navigation.`);
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return new HumanMessage('');
  }
}

export function getPlannerPrompt(task: string, browserContext: BrowserContext): string {
  return `
// existing code...

Important instructions:
1. No matter what the user task is, ALWAYS start by using the searchLinkedIn action to direct the user to LinkedIn job search results related to their query.
2. After the initial LinkedIn search, you can proceed with further steps to help the user.
3. DO NOT suggest actions on non-LinkedIn websites under any circumstances.
4. If the user asks for actions on other websites, politely inform them that you can only assist with LinkedIn-related tasks.

// existing code...
`;
}
