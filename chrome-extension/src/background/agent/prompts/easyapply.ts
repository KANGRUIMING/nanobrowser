import { BasePrompt } from './base';
import { type HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';

export class EasyApplyPrompt extends BasePrompt {
  private readonly default_action_description = 'A placeholder action description';

  constructor(private readonly maxActionsPerStep = 10) {
    super();
  }

  importantRules(): string {
    // Similar rules as navigator but focused on application process
    // existing code...
  }

  inputFormat(): string {
    // Same as navigator
    // existing code...
  }

  getSystemMessage(): SystemMessage {
    const AGENT_PROMPT = `You are a specialized LinkedIn Easy Apply assistant.

IMPORTANT INSTRUCTIONS:
1. You ONLY handle the job application process AFTER the search is complete
2. Your responsibilities include:
   - Analyzing job listings from search results
   - Clicking on Easy Apply buttons
   - Filling application forms
   - Uploading resumes (if provided by the user)
   - Submitting applications
3. NEVER perform searches - that's handled by the search agent
4. Only work with LinkedIn websites
5. Follow all application steps precisely
6. Provide detailed feedback on applications submitted

${this.inputFormat()}

${this.importantRules()}

Functions:
${this.default_action_description}

Remember: Your job is to efficiently apply to positions after the search agent has found them.`;

    return new SystemMessage(AGENT_PROMPT);
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return await this.buildBrowserStateUserMessage(context);
  }
}
