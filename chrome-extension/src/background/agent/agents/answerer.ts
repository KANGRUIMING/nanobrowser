import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { z } from 'zod';
import type { AgentOutput } from '../types';
import { HumanMessage } from '@langchain/core/messages';
import { Actors, ExecutionState } from '../event/types';
import { isAuthenticationError } from '@src/background/utils';
import { ChatModelAuthError } from './errors';
import { ActionResult } from '../types';

const logger = createLogger('AnswererAgent');

// Define Zod schema for answerer output
export const answererOutputSchema = z.object({
  field_name: z.string(),
  response: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string()
});

export type AnswererOutput = z.infer<typeof answererOutputSchema>;

export class AnswererAgent extends BaseAgent<typeof answererOutputSchema, AnswererOutput> {
  // Store resume and job preferences
  private resume: string;
  private jobPreferences: string;
  private currentElementIndex?: number;
  
  constructor(
    resume: string,
    jobPreferences: string,
    options: BaseAgentOptions, 
    extraOptions?: Partial<ExtraAgentOptions>
  ) {
    super(answererOutputSchema, options, { ...extraOptions, id: 'answerer' });
    this.resume = resume;
    this.jobPreferences = jobPreferences;
  }

  /**
   * Set the current element index for the answerer to focus on
   * @param elementIndex The DOM element index to focus on
   */
  setElementIndex(elementIndex: number): void {
    this.currentElementIndex = elementIndex;
  }

  /**
   * Executes the answerer agent to generate a response for a job application form field
   * @param elementIndex Optional element index to focus on
   * @returns AgentOutput<AnswererOutput>
   */
  async execute(elementIndex?: number): Promise<AgentOutput<AnswererOutput>> {
    try {
      // If an element index is provided, set it for this execution
      if (elementIndex !== undefined) {
        this.setElementIndex(elementIndex);
      }
      
      // Add element index to the context for the prompt to access
      if (this.currentElementIndex !== undefined) {
        // Add information about the element index to the action results
        // so the prompt can extract it
        if (!this.context.actionResults.length) {
          this.context.actionResults = [
            new ActionResult({
              extractedContent: `Form field element_index: ${this.currentElementIndex}`,
              includeInMemory: false
            })
          ];
        }
      }
      
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.STEP_START, 'Analyzing form field...');

      // Get the current form context
      const stateMessage = await this.prompt.getUserMessage(this.context);
      const systemMessage = this.prompt.getSystemMessage();
      const inputMessages = [systemMessage, stateMessage];

      // Call the model to generate a response
      const modelOutput = await this.invoke(inputMessages);
      if (!modelOutput) {
        throw new Error('Failed to generate form field response');
      }

      logger.info('answerer output', JSON.stringify(modelOutput, null, 2));

      // Emit success event
      this.context.emitEvent(
        Actors.SYSTEM, 
        ExecutionState.STEP_OK, 
        `Generated response for '${modelOutput.field_name}' field`
      );

      return {
        id: this.id,
        result: modelOutput,
      };
    } catch (error) {
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError('Answerer API Authentication failed. Please verify your API key', error);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Answerer failed: ${errorMessage}`);
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.STEP_FAIL, `Form analysis failed: ${errorMessage}`);
      return {
        id: this.id,
        error: `Answerer failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Get the form field response for use in filling out the application
   * This is a convenience method for the navigator to directly use the generated response
   * @param elementIndex Optional element index to focus on
   */
  async getFormFieldResponse(elementIndex?: number): Promise<string | null> {
    const output = await this.execute(elementIndex);
    return output.result?.response || null;
  }
} 