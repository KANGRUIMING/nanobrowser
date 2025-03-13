import { ActionResult, type AgentContext } from '@src/background/agent/types';
import {
  clickElementActionSchema,
  doneActionSchema,
  extractContentActionSchema,
  goBackActionSchema,
  goToUrlActionSchema,
  inputTextActionSchema,
  openTabActionSchema,
  searchGoogleActionSchema,
  switchTabActionSchema,
  type ActionSchema,
  scrollDownActionSchema,
  scrollUpActionSchema,
  sendKeysActionSchema,
  scrollToTextActionSchema,
  cacheContentActionSchema,
  stealthModeActionSchema,
} from './schemas';
import { z } from 'zod';
import { createLogger } from '@src/background/log';
import { PromptTemplate } from '@langchain/core/prompts';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ExecutionState, Actors } from '../event/types';

const logger = createLogger('Action');

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/**
 * An action is a function that takes an input and returns an ActionResult
 */
export class Action {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly handler: (input: any) => Promise<ActionResult>,
    public readonly schema: ActionSchema,
  ) {}

  async call(input: unknown): Promise<ActionResult> {
    // Validate input before calling the handler
    const schema = this.schema.schema;

    // check if the schema is schema: z.object({}), if so, ignore the input
    const isEmptySchema =
      schema instanceof z.ZodObject &&
      Object.keys((schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape || {}).length === 0;

    if (isEmptySchema) {
      return await this.handler({});
    }

    const parsedArgs = this.schema.schema.safeParse(input);
    if (!parsedArgs.success) {
      const errorMessage = parsedArgs.error.message;
      throw new InvalidInputError(errorMessage);
    }
    return await this.handler(parsedArgs.data);
  }

  name() {
    return this.schema.name;
  }

  /**
   * Returns the prompt for the action
   * @returns {string} The prompt for the action
   */
  prompt() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schemaShape = (this.schema.schema as z.ZodObject<any>).shape || {};
    const schemaProperties = Object.entries(schemaShape).map(([key, value]) => {
      const zodValue = value as z.ZodTypeAny;
      return `'${key}': {'type': '${zodValue.description}', ${zodValue.isOptional() ? "'optional': true" : "'required': true"}}`;
    });

    const schemaStr =
      schemaProperties.length > 0 ? `{${this.name()}: {${schemaProperties.join(', ')}}}` : `{${this.name()}: {}}`;

    return `${this.schema.description}:\n${schemaStr}`;
  }
}

// TODO: can not make every action optional, don't know why
export function buildDynamicActionSchema(actions: Action[]): z.ZodType {
  let schema = z.object({});
  for (const action of actions) {
    // create a schema for the action, it could be action.schema.schema or null
    // but don't use default: null as it causes issues with Google Generative AI
    const actionSchema = action.schema.schema.nullable();
    schema = schema.extend({
      [action.name()]: actionSchema,
    });
  }
  return schema.partial().nullable();
}

export class ActionBuilder {
  private readonly context: AgentContext;
  private readonly extractorLLM: BaseChatModel;

  constructor(context: AgentContext, extractorLLM: BaseChatModel) {
    this.context = context;
    this.extractorLLM = extractorLLM;
  }

  buildDefaultActions() {
    const actions = [];

    const done = new Action(async (input: z.infer<typeof doneActionSchema.schema>) => {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, doneActionSchema.name);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, input.text);
      return new ActionResult({
        isDone: true,
        extractedContent: input.text,
      });
    }, doneActionSchema);
    actions.push(done);

    const searchGoogle = new Action(async (input: { query: string }) => {
      const msg = `Searching for "${input.query}" in Google`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

      const page = await this.context.browserContext.getCurrentPage();
      await page.navigateTo(`https://www.google.com/search?q=${input.query}`);

      const msg2 = `Searched for "${input.query}" in Google`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, searchGoogleActionSchema);
    actions.push(searchGoogle);

    const goToUrl = new Action(async (input: { url: string }) => {
      const msg = `Navigating to ${input.url}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

      await this.context.browserContext.navigateTo(input.url);
      const msg2 = `Navigated to ${input.url}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, goToUrlActionSchema);
    actions.push(goToUrl);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const goBack = new Action(async (_input = {}) => {
      const msg = 'Navigating back';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

      const page = await this.context.browserContext.getCurrentPage();
      await page.goBack();
      const msg2 = 'Navigated back';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, goBackActionSchema);
    actions.push(goBack);

    // Element Interaction Actions
    const clickElement = new Action(async (input: z.infer<typeof clickElementActionSchema.schema>) => {
      const todo = input.desc || `Click element with index ${input.index}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, todo);

      const page = await this.context.browserContext.getCurrentPage();
      const state = await page.getState();

      const elementNode = state?.selectorMap.get(input.index);
      if (!elementNode) {
        throw new Error(`Element with index ${input.index} does not exist - retry or use alternative actions`);
      }

      // Check if element is a file uploader
      if (await page.isFileUploader(elementNode)) {
        const msg = `Index ${input.index} - has an element which opens file upload dialog. To upload files please use a specific function to upload files`;
        logger.info(msg);
        return new ActionResult({
          extractedContent: msg,
          includeInMemory: true,
        });
      }

      try {
        const initialTabIds = await this.context.browserContext.getAllTabIds();
        await page.clickElementNode(this.context.options.useVision, elementNode);
        let msg = `Clicked button with index ${input.index}: ${elementNode.getAllTextTillNextClickableElement(2)}`;
        logger.info(msg);

        // TODO: could be optimized by chrome extension tab api
        const currentTabIds = await this.context.browserContext.getAllTabIds();
        if (currentTabIds.size > initialTabIds.size) {
          const newTabMsg = 'New tab opened - switching to it';
          msg += ` - ${newTabMsg}`;
          logger.info(newTabMsg);
          // find the tab id that is not in the initial tab ids
          const newTabId = Array.from(currentTabIds).find(id => !initialTabIds.has(id));
          if (newTabId) {
            await this.context.browserContext.switchTab(newTabId);
          }
        }
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      } catch (error) {
        const msg = `Element no longer available with index ${input.index} - most likely the page changed`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, clickElementActionSchema);
    actions.push(clickElement);

    const inputText = new Action(async (input: z.infer<typeof inputTextActionSchema.schema>) => {
      const todo = input.desc || `Input text into index ${input.index}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, todo);

      const page = await this.context.browserContext.getCurrentPage();
      const state = await page.getState();

      const elementNode = state?.selectorMap.get(input.index);
      if (!elementNode) {
        throw new Error(`Element with index ${input.index} does not exist - retry or use alternative actions`);
      }

      await page.inputTextElementNode(this.context.options.useVision, elementNode, input.text);
      const msg = `Input ${input.text} into index ${input.index}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, inputTextActionSchema);
    actions.push(inputText);

    // Tab Management Actions
    const switchTab = new Action(async (input: z.infer<typeof switchTabActionSchema.schema>) => {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Switching to tab ${input.tab_id}`);
      await this.context.browserContext.switchTab(input.tab_id);
      const msg = `Switched to tab ${input.tab_id}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, switchTabActionSchema);
    actions.push(switchTab);

    const openTab = new Action(async (input: z.infer<typeof openTabActionSchema.schema>) => {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Opening ${input.url} in new tab`);
      await this.context.browserContext.openTab(input.url);
      const msg = `Opened ${input.url} in new tab`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, openTabActionSchema);
    actions.push(openTab);

    // Content Actions
    const extractContent = new Action(async (input: z.infer<typeof extractContentActionSchema.schema>) => {
      const goal = input.goal;
      const page = await this.context.browserContext.getCurrentPage();
      const content = await page.getReadabilityContent();

      // Get current browser state for context
      const browserState = await this.context.browserContext.getState();

      // Create a more comprehensive prompt
      const promptTemplate = PromptTemplate.fromTemplate(
        'Your task is to extract and analyze the content of this webpage in relation to the specified goal. Extract all relevant information including specific job details (title, company, requirements, etc.) if applicable.\n\n' +
          'GOAL: {goal}\n\n' +
          'PAGE TITLE: {title}\n' +
          'PAGE URL: {url}\n\n' +
          'PAGE CONTENT:\n{content}\n\n' +
          'Provide a detailed summary focusing on:\n' +
          '1. Key information relevant to the goal\n' +
          '2. Important form fields or interactive elements\n' +
          '3. Specific job details including company name, position title, requirements\n' +
          '4. Any obstacles or special requirements (login, etc.)\n\n' +
          'Format your response to be concise but comprehensive.',
      );

      const prompt = await promptTemplate.invoke({
        goal,
        title: browserState.title,
        url: browserState.url,
        content: content.content,
      });

      try {
        const output = await this.extractorLLM.invoke(prompt);
        const msg = `📄 CONTENT ANALYSIS:\n${output.content}\n`;

        // Add this to page history with improved summary
        this.context.messageManager.addPageToHistory(
          browserState.url,
          browserState.title || 'No title',
          typeof output.content === 'string' ? output.content : JSON.stringify(output.content),
        );

        return new ActionResult({
          extractedContent: msg,
          includeInMemory: true,
        });
      } catch (error) {
        logger.error(`Error extracting content: ${error instanceof Error ? error.message : String(error)}`);
        const msg =
          'Failed to extract content from page, you need to extract content from the current state of the page and store it in the memory. Then scroll down if you still need more information.';
        return new ActionResult({
          extractedContent: msg,
          includeInMemory: true,
        });
      }
    }, extractContentActionSchema);
    actions.push(extractContent);

    // Add a new action to analyze browsing history
    const analyzeHistoryActionSchema = {
      name: 'analyze_browser_history',
      description: 'Analyze browser history to gain insights about previous navigation and actions',
      schema: z.object({
        goal: z
          .string()
          .describe('The analysis goal like "Find login patterns" or "Identify previous job applications"'),
      }),
    };

    const analyzeHistory = new Action(async (input: z.infer<typeof analyzeHistoryActionSchema.schema>) => {
      const goal = input.goal;

      // Get the browsing history
      const historyContext = this.context.messageManager.getPageHistoryContext();

      if (!historyContext || historyContext.trim() === '') {
        return new ActionResult({
          extractedContent: 'No browsing history available to analyze.',
          includeInMemory: true,
        });
      }

      const promptTemplate = PromptTemplate.fromTemplate(
        'Analyze the browser history below and provide insights related to the specified goal.\n\n' +
          'ANALYSIS GOAL: {goal}\n\n' +
          'BROWSER HISTORY:\n{history}\n\n' +
          'Provide a detailed analysis including:\n' +
          '1. Patterns in navigation\n' +
          '2. Successful and unsuccessful interactions\n' +
          '3. Progress made toward completing tasks\n' +
          '4. Recommendations for next steps\n' +
          '5. Any loops or repetitive behavior detected\n\n' +
          'Be specific and actionable in your analysis.',
      );

      const prompt = await promptTemplate.invoke({
        goal,
        history: historyContext,
      });

      try {
        const output = await this.extractorLLM.invoke(prompt);
        const msg = `🔍 HISTORY ANALYSIS:\n${output.content}\n`;

        return new ActionResult({
          extractedContent: msg,
          includeInMemory: true,
        });
      } catch (error) {
        logger.error(`Error analyzing history: ${error instanceof Error ? error.message : String(error)}`);
        const msg = 'Failed to analyze browsing history.';
        return new ActionResult({
          extractedContent: msg,
          includeInMemory: true,
        });
      }
    }, analyzeHistoryActionSchema);
    actions.push(analyzeHistory);

    // cache content for future use
    const cacheContent = new Action(async (input: z.infer<typeof cacheContentActionSchema.schema>) => {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, cacheContentActionSchema.name);

      const msg = `Cached findings: ${input.content}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, cacheContentActionSchema);
    actions.push(cacheContent);

    const scrollDown = new Action(async (input: z.infer<typeof scrollDownActionSchema.schema>) => {
      const todo = input.desc || 'Scroll down the page';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, todo);

      const page = await this.context.browserContext.getCurrentPage();
      await page.scrollDown(input.amount);
      const amount = input.amount !== undefined ? `${input.amount} pixels` : 'one page';
      const msg = `Scrolled down the page by ${amount}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollDownActionSchema);
    actions.push(scrollDown);

    const scrollUp = new Action(async (input: z.infer<typeof scrollUpActionSchema.schema>) => {
      const todo = input.desc || 'Scroll up the page';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, todo);

      const page = await this.context.browserContext.getCurrentPage();
      await page.scrollUp(input.amount);
      const amount = input.amount !== undefined ? `${input.amount} pixels` : 'one page';
      const msg = `Scrolled up the page by ${amount}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollUpActionSchema);
    actions.push(scrollUp);

    // Keyboard Actions
    const sendKeys = new Action(async (input: z.infer<typeof sendKeysActionSchema.schema>) => {
      const todo = input.desc || `Send keys: ${input.keys}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, todo);

      const page = await this.context.browserContext.getCurrentPage();
      await page.sendKeys(input.keys);
      const msg = `Sent keys: ${input.keys}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, sendKeysActionSchema);
    actions.push(sendKeys);

    const scrollToText = new Action(async (input: z.infer<typeof scrollToTextActionSchema.schema>) => {
      const todo = input.desc || `Scroll to text: ${input.text}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, todo);

      const page = await this.context.browserContext.getCurrentPage();
      try {
        const scrolled = await page.scrollToText(input.text);
        const msg = scrolled
          ? `Scrolled to text: ${input.text}`
          : `Text '${input.text}' not found or not visible on page`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      } catch (error) {
        const msg = `Failed to scroll to text: ${error instanceof Error ? error.message : String(error)}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
    }, scrollToTextActionSchema);
    actions.push(scrollToText);

    // Add a new action to revisit a page from history
    const revisitPageActionSchema = {
      name: 'revisit_page',
      description: 'Revisit a page that was previously seen in browser history',
      schema: z.object({
        url_pattern: z
          .string()
          .describe('A pattern to match against URLs in the browsing history, or the exact URL to revisit'),
      }),
    };

    const revisitPage = new Action(async (input: z.infer<typeof revisitPageActionSchema.schema>) => {
      const urlPattern = input.url_pattern.toLowerCase();

      // Get page history from message manager
      const pageHistory = this.context.messageManager.getPageHistoryRaw();

      if (!pageHistory || pageHistory.length === 0) {
        return new ActionResult({
          extractedContent: 'No browsing history available to revisit pages.',
          includeInMemory: true,
          error: 'No browsing history available',
        });
      }

      // Find matching pages in history
      const matchingPages = pageHistory.filter(
        (page: { url: string; title: string; summary: string; timestamp: number }) =>
          page.url.toLowerCase().includes(urlPattern),
      );

      if (matchingPages.length === 0) {
        return new ActionResult({
          extractedContent: `No pages matching pattern "${urlPattern}" found in browsing history.`,
          includeInMemory: true,
          error: `No matching pages found for pattern: ${urlPattern}`,
        });
      }

      // Get the most recent matching page
      const pageToRevisit = matchingPages[matchingPages.length - 1];

      // Navigate to the page
      try {
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Revisiting page: ${pageToRevisit.url}`);
        await this.context.browserContext.navigateTo(pageToRevisit.url);
        const msg = `Revisited page from history: ${pageToRevisit.title} (${pageToRevisit.url})`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({
          extractedContent: msg,
          includeInMemory: true,
        });
      } catch (error) {
        logger.error(`Error revisiting page: ${error instanceof Error ? error.message : String(error)}`);
        const msg = `Failed to revisit page: ${pageToRevisit.url}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({
          extractedContent: msg,
          includeInMemory: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, revisitPageActionSchema);
    actions.push(revisitPage);

    // Add stealth mode action to bypass anti-bot protection
    const stealthMode = new Action(async (input: z.infer<typeof stealthModeActionSchema.schema>) => {
      const enabled = input.enabled;
      const level = input.level || 'medium'; // Default to medium protection

      // Set up the context with stealth mode settings
      this.context.browserContext.setStealthMode(enabled, level);

      const statusText = enabled
        ? `Enabled stealth mode with ${level} protection level to bypass anti-bot measures`
        : 'Disabled stealth mode';

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, statusText);

      // Add random delay to make it harder to detect automation
      await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 1000) + 500));

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, statusText);

      return new ActionResult({
        extractedContent: statusText,
        includeInMemory: true,
      });
    }, stealthModeActionSchema);
    actions.push(stealthMode);

    return actions;
  }
}
