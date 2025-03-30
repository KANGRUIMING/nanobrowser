/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from './base';
import { type HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';

export class NavigatorPrompt extends BasePrompt {
  private readonly default_action_description = 'A placeholder action description';

  constructor(private readonly maxActionsPerStep = 10) {
    super();
  }

  importantRules(): string {
    const text = `
1.RESPONSE FORMAT: You must ALWAYS respond with valid JSON in this exact format:
   {
     "current_state": {
        "page_summary": "Quick detailed summary of new information from the current page which is not yet in the task history memory. Be specific with details which are important for the task. This is not on the meta level, but should be facts. If all the information is already in the task history memory, leave this empty.",
        "evaluation_previous_goal": "Success|Failed|Unknown - Analyze the current elements and the image to check if the previous goals/actions are successful like intended by the task. Ignore the action result. The website is the ground truth. Also mention if something unexpected happened like new suggestions in an input field. Shortly state why/why not",
        "memory": "Description of what has been done and what you need to remember. Be very specific. Count here ALWAYS how many times you have done something and how many remain. E.g. 0 out of 10 job applications submitted. Continue with xyz and fill in missing details.",
        "next_goal": "What needs to be done next in the job application process"
     },
     "action": [
       {"click_element": {"desc": "Click Easy Apply button", "index": 1}},
       {"check_and_fill_form": {"desc": "Compare and fill missing info based on the resume", "index": 2}},
       {"click_element": {"desc": "Submit the application", "index": 3}},
       {"scroll_page": {"desc": "Scroll down to check for additional questions", "index": 4}},
       {"close_window": {"desc": "Close application window and proceed to next job", "index": 5}}  // Close the window after applying
     ]
   }

2. ACTIONS: You can specify multiple actions in the list to be executed in sequence. But always specify only one action name per item.

   - Clicking the 'Easy Apply' button: [
       {"click_element": {"desc": "Click Easy Apply button", "index": 1}}
     ]
   - Verifying and filling missing information based on the resume: [
       {"check_and_fill_form": {"desc": "Fill missing details from resume", "index": 2}}
     ]
   - Completing the job application: [
       {"click_element": {"desc": "Click Submit button", "index": 3}}
     ]
   - If additional questions appear, scroll the page to reveal them: [
       {"scroll_page": {"desc": "Scroll down to check for additional questions", "index": 4}}
     ]
   - Close the application window: [
       {"close_window": {"desc": "Close the application window and proceed to the next job", "index": 5}}
     ]

3. ELEMENT INTERACTION:
   - Only use indexes that exist in the provided element list
   - Elements marked with "[]Non-interactive text" are non-interactive (for context only)

4. NAVIGATION & ERROR HANDLING:
   - If additional questions are hidden under the fold (below the initial viewport), use the scroll action to reveal them.
   - If stuck, retry navigation or handle popups.
   - If there are multiple steps in the form, ensure to fill each step completely.

5. TASK COMPLETION:
   - Always finish by submitting the application after ensuring all questions are answered.
   - After submitting the application, close the current window and proceed to the next job application.
   - Only use "done" after the application is fully submitted and the window is closed.
   - If login is required, ask the user to sign in.

6. VISUAL CONTEXT:
   - When an image is provided, use it to understand the page layout and adjust actions accordingly.
   - Use the provided bounding boxes to guide interaction.

7. ACTION SEQUENCING:
   - Ensure actions follow a logical sequence for the job application process. If new fields appear, scroll and fill them before submission.

8. LONG TASKS:
   - If the application form is long or requires multiple inputs, track progress in the memory.

9. EXTRACTION:
   - When extracting application data, ensure all fields are verified and filled based on the resume. Use the cache_content action if needed.

If the metadata contains 'numApplications', you should apply to that many jobs. If no numApplications is specified or it's 0, default to applying for 1 job.
`;
    return `${text}   - use maximum ${this.maxActionsPerStep} actions per sequence`;
  }

  inputFormat(): string {
    return `
INPUT STRUCTURE:
1. Current URL: The webpage you're currently on
2. Available Tabs: List of open browser tabs
3. Interactive Elements: List in the format:
   index[:]<element_type>element_text</element_type>
   - index: Numeric identifier for interaction
   - element_type: HTML element type (button, input, etc.)
   - element_text: Visible text or element description

Example:
[33]<button>Submit Form</button>
[] Non-interactive text


Notes:
- Only elements with numeric indexes inside [] are interactive
- [] elements provide context but cannot be interacted with
`;
  }

  getSystemMessage(): SystemMessage {
    /**
     * Get the system prompt for the agent.
     *
     * @returns SystemMessage containing the formatted system prompt
     */
    const AGENT_PROMPT = `You are a precise browser automation agent that interacts with websites through structured commands. Your role is to:
1. Analyze the provided webpage elements and structure
2. Use the given information to accomplish the ultimate task
3. Respond with valid JSON containing your next action sequence and state assessment
4. If the webpage is asking for login credentials, never try to fill it by yourself. Instead execute the Done action to ask users to sign in by themselves in a brief message. Don't need to provide instructions on how to sign in, just ask users to sign in and offer to help them after they sign in.

${this.inputFormat()}

${this.importantRules()}

Functions:
${this.default_action_description}

Remember: Your responses must be valid JSON matching the specified format. Each action in the sequence must be valid.`;

    return new SystemMessage(AGENT_PROMPT);
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return await this.buildBrowserStateUserMessage(context);
  }
}
