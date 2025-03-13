import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { ActionResult, type AgentOutput } from '../types';
import type { Action } from '../actions/builder';
import { buildDynamicActionSchema } from '../actions/builder';
import { agentBrainSchema } from '../types';
import { type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { Actors, ExecutionState } from '../event/types';
import { isAuthenticationError } from '@src/background/utils';
import { ChatModelAuthError } from './errors';
import { jsonNavigatorOutputSchema } from '../actions/json_schema';
import { geminiNavigatorOutputSchema } from '../actions/json_gemini';
const logger = createLogger('NavigatorAgent');

export class NavigatorActionRegistry {
  private actions: Record<string, Action> = {};

  constructor(actions: Action[]) {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  registerAction(action: Action): void {
    this.actions[action.name()] = action;
  }

  unregisterAction(name: string): void {
    delete this.actions[name];
  }

  getAction(name: string): Action | undefined {
    return this.actions[name];
  }

  setupModelOutputSchema(): z.ZodType {
    const actionSchema = buildDynamicActionSchema(Object.values(this.actions));
    return z.object({
      current_state: agentBrainSchema,
      action: z.array(actionSchema),
    });
  }
}

export interface NavigatorResult {
  done: boolean;
}

export class NavigatorAgent extends BaseAgent<z.ZodType, NavigatorResult> {
  private actionRegistry: NavigatorActionRegistry;
  private jsonSchema: Record<string, unknown>;

  constructor(
    actionRegistry: NavigatorActionRegistry,
    options: BaseAgentOptions,
    extraOptions?: Partial<ExtraAgentOptions>,
  ) {
    super(actionRegistry.setupModelOutputSchema(), options, { ...extraOptions, id: 'navigator' });

    this.actionRegistry = actionRegistry;

    this.jsonSchema = this.modelName.startsWith('gemini') ? geminiNavigatorOutputSchema : jsonNavigatorOutputSchema;
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    // Use structured output
    if (this.withStructuredOutput) {
      const structuredLlm = this.chatLLM.withStructuredOutput(this.jsonSchema, {
        includeRaw: true,
      });

      const response = await structuredLlm.invoke(inputMessages, {
        ...this.callOptions,
      });

      if (response.parsed) {
        return response.parsed;
      }
      throw new Error('Could not parse response');
    }

    // Without structured output support, need to extract JSON from model output manually
    const response = await this.chatLLM.invoke(inputMessages, {
      ...this.callOptions,
    });
    if (typeof response.content === 'string') {
      response.content = this.removeThinkTags(response.content);
      try {
        const extractedJson = this.extractJsonFromModelOutput(response.content);
        const parsed = this.validateModelOutput(extractedJson);
        if (parsed) {
          return parsed;
        }
      } catch (error) {
        logger.error('Could not parse response', response);
        throw new Error('Could not parse response');
      }
    }
    throw new Error('Could not parse response');
  }

  async execute(): Promise<AgentOutput<NavigatorResult>> {
    try {
      // Before executing, make sure there's a valid state with a goal
      await this.ensureStateHasGoal();

      // Add current state to memory periodically
      await this.addStateMessageToMemory();

      // Record step start
      this.context.nSteps += 1;
      if (this.context.nSteps > this.context.options.maxSteps) {
        await this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_FAIL, 'Reached maximum number of steps');
        return {
          id: this.id,
          error: 'Reached maximum number of steps',
        };
      }

      const messages = this.context.messageManager.getMessages();
      await this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.STEP_START,
        `Executing step ${this.context.nSteps}/${this.context.options.maxSteps}`,
      );

      // Use model to get action step
      let response: this['ModelOutput'];
      try {
        response = await this.invoke(messages);
      } catch (error) {
        // Check if the error is an authentication error
        if (isAuthenticationError(error)) {
          await this.context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.TASK_FAIL,
            'Invalid authentication: please check your API key or quota.',
          );
          throw new ChatModelAuthError(error instanceof Error ? error.message : String(error));
        } else {
          logger.error('Error invoking model', error);
          throw error;
        }
      }

      // Call the action(s) based on the model's output
      const actionResults = await this.doMultiAction(response);

      // Check if any of the actions signal that the task is complete
      const isDone = actionResults.some(result => result.isDone);

      // Preserve the goal in case it was lost during navigation or script blocking
      await this.ensureStateHasGoal();

      if (isDone) {
        await this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_OK, 'Task completed successfully');
        return {
          id: this.id,
          result: {
            done: true,
          },
        };
      }

      // Return that this step has been completed successfully, but we're not done yet
      return {
        id: this.id,
        result: {
          done: false,
        },
      };
    } catch (error) {
      // Increment failure counter
      this.context.consecutiveFailures += 1;

      // If too many failures, signal to stop
      if (this.context.consecutiveFailures >= this.context.options.maxFailures) {
        await this.context.emitEvent(
          Actors.NAVIGATOR,
          ExecutionState.TASK_FAIL,
          `Too many failures (${this.context.consecutiveFailures}/${this.context.options.maxFailures})`,
        );
        return {
          id: this.id,
          error: `Too many failures (${this.context.consecutiveFailures}/${this.context.options.maxFailures})`,
        };
      }

      // Report the error
      let errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.length > this.context.options.maxErrorLength) {
        errorMsg = errorMsg.substring(0, this.context.options.maxErrorLength) + '...';
      }
      await this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_FAIL, errorMsg);

      // Try to add a clean human message to help the model recover
      try {
        await this.context.messageManager.addMessageWithTokens(
          new HumanMessage(
            `I encountered an error: ${errorMsg}. I'll try to recover and continue with the task from the last valid state.`,
          ),
        );
      } catch (messageError) {
        logger.error('Error adding recovery message', messageError);
        // If we can't even add a message, something is severely wrong
        await this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_FAIL, 'Failed to recover from error');
        return {
          id: this.id,
          error: `Failed to recover from error: ${
            messageError instanceof Error ? messageError.message : String(messageError)
          }`,
        };
      }

      // Remove the failed state message
      await this.removeLastStateMessageFromMemory();

      // Check if we need to wait before retrying (avoid hammering the model)
      if (this.context.options.retryDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.context.options.retryDelay * 1000));
      }

      // Try to ensure we have a valid goal before continuing
      await this.ensureStateHasGoal();

      // Return that we've handled the error, but not completed the task
      return {
        id: this.id,
        result: {
          done: false,
        },
      };
    }
  }

  /**
   * Add the state message to the memory
   */
  public async addStateMessageToMemory(customState?: Record<string, unknown>) {
    // If already added, don't add again unless we have a custom state
    if (this.context.stateMessageAdded && !customState) {
      return;
    }

    // Get the message manager
    const messageManager = this.context.messageManager;

    let state: string;
    if (customState) {
      // Use the provided custom state
      state = JSON.stringify(customState);
    } else {
      // Generate a default state
      const stateObj = {
        current_state: {
          page_summary: 'Current page content',
          evaluation_previous_goal: 'No previous goal to evaluate',
          memory: '',
          next_goal: 'To be determined',
        },
      };
      state = JSON.stringify(stateObj);
    }

    // Add the state message
    messageManager.addMessageWithTokens(new HumanMessage(state));
    this.context.stateMessageAdded = true;
  }

  /**
   * Remove the last state message from the memory
   */
  protected async removeLastStateMessageFromMemory() {
    if (!this.context.stateMessageAdded) return;
    const messageManager = this.context.messageManager;
    messageManager.removeLastStateMessage();
    this.context.stateMessageAdded = false;
  }

  private async doMultiAction(response: this['ModelOutput']): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    let errCount = 0;

    logger.info('Actions', response.action);
    // sometimes response.action is a string, but not an array as expected, so we need to parse it as an array
    let actions: Record<string, unknown>[] = [];
    if (Array.isArray(response.action)) {
      // if the item is null, skip it
      actions = response.action.filter((item: unknown) => item !== null);
      if (actions.length === 0) {
        logger.warning('No valid actions found', response.action);
      }
    } else if (typeof response.action === 'string') {
      try {
        logger.warning('Unexpected action format', response.action);
        // try to parse the action as an JSON object
        actions = JSON.parse(response.action);
      } catch (error) {
        logger.error('Invalid action format', response.action);
        throw new Error('Invalid action output format');
      }
    } else {
      // if the action is neither an array nor a string, it should be an object
      actions = [response.action];
    }

    for (const action of actions) {
      const actionName = Object.keys(action)[0];
      const actionArgs = action[actionName];
      try {
        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }

        const result = await this.actionRegistry.getAction(actionName)?.call(actionArgs);
        if (result === undefined) {
          throw new Error(`Action ${actionName} not exists or returned undefined`);
        }
        results.push(result);
        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }
        // TODO: wait for 1 second for now, need to optimize this to avoid unnecessary waiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('doAction error', actionName, actionArgs, errorMessage);
        // unexpected error, emit event
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMessage);
        errCount++;
        if (errCount > 3) {
          throw new Error('Too many errors in actions');
        }
        results.push(
          new ActionResult({
            error: errorMessage,
            isDone: false,
            includeInMemory: true,
          }),
        );
      }
    }
    return results;
  }

  /**
   * Ensures that the agent's state always has a goal, even after navigation or script injection failures
   * This prevents the "invalid_type" error for the required "goal" property
   */
  private async ensureStateHasGoal(): Promise<void> {
    try {
      // Get the latest messages to find if we have a valid goal
      const messages = this.context.messageManager.getMessages();
      let hasValidGoal = false;
      let lastGoal: string | null = null;

      // Look through messages to find the latest state
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.content && typeof message.content === 'string') {
          const content = message.content;

          // Try to extract the goal from the message
          const nextGoalMatch = content.match(/"next_goal"\s*:\s*"([^"]+)"/);
          if (nextGoalMatch && nextGoalMatch[1]) {
            lastGoal = nextGoalMatch[1];
            hasValidGoal = true;
            break;
          }
        }
      }

      // If we don't have a valid goal, get it from the latest task
      if (!hasValidGoal) {
        // Get the tasks from message history - the most recent task is our goal
        const taskMessages = this.context.messageManager
          .getMessages()
          .filter(
            msg => msg.name === 'Human' && typeof msg.content === 'string' && !msg.content.includes('current_state'),
          );
        if (taskMessages.length > 0) {
          // Extract task from last human message
          const content = taskMessages[taskMessages.length - 1].content;
          if (typeof content === 'string') {
            lastGoal = content;
            logger.info(`Retrieved goal from task history: ${lastGoal}`);
          }
        }
      }

      // If we still don't have a goal, use a generic one to prevent schema errors
      if (!lastGoal) {
        lastGoal = 'Continue helping with the current task';
        logger.info('Using fallback goal to prevent schema errors');
      }

      // Ensure our current state has this goal by adding a proper state message
      const stateObject = {
        current_state: {
          page_summary: 'Current page content',
          evaluation_previous_goal: 'Continuing with the task',
          memory: 'Task memory is preserved',
          next_goal: lastGoal,
        },
      };

      // If state message was added and we need to ensure goal, update it
      if (this.context.stateMessageAdded) {
        logger.info(`Ensuring goal is preserved in agent state: ${lastGoal}`);

        // Create a state object with the preserved goal
        await this.addStateMessageToMemory(stateObject);
      }

      if (this.context.stateMessageAdded && lastGoal) {
        logger.info(`Ensuring goal is preserved in agent state: ${lastGoal}`);

        // Create a state object with the preserved goal
        const goalStateObj = {
          current_state: {
            page_summary: 'Current page content',
            evaluation_previous_goal: 'Continuing with the task',
            memory: 'Task memory is preserved',
            next_goal: lastGoal,
          },
        };

        // Add the state message with proper JSON formatting
        await this.addStateMessageToMemory(goalStateObj);
      }
    } catch (error) {
      logger.error('Error ensuring state has goal:', error);
      // Don't throw, we want to continue even if this fails
    }
  }
}
