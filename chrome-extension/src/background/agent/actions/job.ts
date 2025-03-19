import { ActionResult } from '../types';
import { 
  searchLinkedInActionSchema, 
  searchIndeedActionSchema,
  searchGlassdoorActionSchema,
  getFormFieldAnswerActionSchema,
  autofillFormActionSchema,
  trackApplicationActionSchema,
  uploadResumeActionSchema
} from './schemas';
import { Action } from './builder';
import { Actors, ExecutionState } from '../event/types';
import { createLogger } from '@src/background/log';
import { AnswererAgent } from '../agents/answerer';
import { AnswererPrompt } from '../prompts/answerer';
import { JobStorageService } from '../services/job-storage';

const logger = createLogger('JobActions');

export function createLinkedInSearchAction(context: any): Action {
  return new Action(async (input: { query: string }) => {
    const searchQuery = input.query;
    const msg = `Searching for "${searchQuery}" on LinkedIn Jobs`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

    const page = await context.browserContext.getCurrentPage();
    await page.navigateTo(
      `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(searchQuery)}&origin=SWITCH_SEARCH_VERTICAL`,
    );

    const msg2 = `Searched for "${searchQuery}" on LinkedIn Jobs`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
    return new ActionResult({
      extractedContent: msg2,
      includeInMemory: true,
    });
  }, searchLinkedInActionSchema);
}

export function createIndeedSearchAction(context: any): Action {
  return new Action(async (input: { query: string }) => {
    const searchQuery = input.query;
    const msg = `Searching for "${searchQuery}" on Indeed Jobs`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

    const page = await context.browserContext.getCurrentPage();
    await page.navigateTo(
      `https://www.indeed.com/jobs?q=${encodeURIComponent(searchQuery)}&l=`,
    );

    const msg2 = `Searched for "${searchQuery}" on Indeed Jobs`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
    return new ActionResult({
      extractedContent: msg2,
      includeInMemory: true,
    });
  }, searchIndeedActionSchema);
}

export function createGlassdoorSearchAction(context: any): Action {
  return new Action(async (input: { query: string }) => {
    const searchQuery = input.query;
    const msg = `Searching for "${searchQuery}" on Glassdoor Jobs`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

    const page = await context.browserContext.getCurrentPage();
    await page.navigateTo(
      `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeURIComponent(searchQuery)}`,
    );

    const msg2 = `Searched for "${searchQuery}" on Glassdoor Jobs`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
    return new ActionResult({
      extractedContent: msg2,
      includeInMemory: true,
    });
  }, searchGlassdoorActionSchema);
}

export function createGetFormFieldAnswerAction(context: any, answererAgent: AnswererAgent): Action {
  return new Action(async (input: { field_name: string, element_index: number, field_type?: string }) => {
    const fieldName = input.field_name;
    const elementIndex = input.element_index;
    const fieldType = input.field_type || 'text';
    
    const msg = `Getting AI response for field "${fieldName}" and filling it`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

    // Use the answerer agent to generate a response, passing the element index
    const output = await answererAgent.execute(elementIndex);
    
    if (output.error) {
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, `Failed to get AI response: ${output.error}`);
      return new ActionResult({
        error: output.error,
        includeInMemory: true,
      });
    }
    
    const response = output.result?.response || '';
    
    // Now fill the form field with the generated response
    try {
      const page = await context.browserContext.getCurrentPage();
      const state = await page.getState();
      const elementNode = state?.selectorMap.get(elementIndex);
      
      if (!elementNode) {
        throw new Error(`Element with index ${elementIndex} not found`);
      }
      
      // Handle different field types
      if (fieldType === 'select') {
        // For select fields, try to find and select the option that best matches the response
        await page.selectDropdownOption(elementIndex, response);
      } else if (fieldType === 'radio' || fieldType === 'checkbox') {
        // For radio/checkbox, just click the element
        await page.clickElementNode(context.options.useVision, elementNode);
      } else {
        // For text/textarea fields, input the text
        await page.inputTextElementNode(context.options.useVision, elementNode, response);
      }
      
      const msg2 = `Generated and filled response for "${fieldName}": "${response.substring(0, 50)}${response.length > 50 ? '...' : ''}"`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const msg3 = `Generated response but failed to fill field: ${errorMessage}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg3);
      
      return new ActionResult({
        extractedContent: `Generated response for ${fieldName}: "${response.substring(0, 50)}${response.length > 50 ? '...' : ''}"`,
        error: msg3,
        includeInMemory: true,
      });
    }
  }, getFormFieldAnswerActionSchema);
}

export function createAutofillFormAction(context: any, resume: string, jobPreferences: string): Action {
  return new Action(async (input: { form_type: string }) => {
    const formType = input.form_type;
    const msg = `Autofilling ${formType} form fields`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

    const page = await context.browserContext.getCurrentPage();
    const state = await page.getState();
    
    // Parse the resume to extract relevant info based on form type
    // This is a placeholder implementation - in a real implementation, 
    // you would have functions to extract specific information from the resume
    const formData = extractFormData(resume, formType);
    
    // Identify form fields
    const formFields = identifyFormFields(state, formType);
    
    // For each identified form field, fill it with the corresponding data
    let fieldsFilled = 0;
    for (const field of formFields) {
      if (field.elementIndex !== undefined && formData[field.fieldName]) {
        const elementNode = state?.selectorMap.get(field.elementIndex);
        if (elementNode) {
          await page.inputTextElementNode(context.options.useVision, elementNode, formData[field.fieldName]);
          fieldsFilled++;
        }
      }
    }
    
    const msg2 = `Autofilled ${fieldsFilled} fields in ${formType} section`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
    return new ActionResult({
      extractedContent: msg2,
      includeInMemory: true,
    });
  }, autofillFormActionSchema);
}

export function createTrackApplicationAction(context: any): Action {
  return new Action(async (input: { company: string, position: string, date_applied?: string, url?: string, status?: string }) => {
    const { company, position, date_applied, url, status } = input;
    const applicationDate = date_applied || new Date().toISOString().split('T')[0];
    const applicationStatus = status || 'applied';
    
    const msg = `Tracking application for ${position} at ${company}`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);
    
    // Check if we've already applied to this job before
    const exists = await JobStorageService.applicationExists(company, position, url);
    if (exists) {
      const duplicateMsg = `Already applied to ${position} at ${company}. Skipping duplicate application.`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, duplicateMsg);
      return new ActionResult({
        extractedContent: duplicateMsg,
        includeInMemory: true,
      });
    }
    
    // Save the application data to storage
    const applicationData = {
      id: `job_${Date.now()}`,
      company,
      position,
      date_applied: applicationDate,
      url: url || window.location.href,
      status: applicationStatus as 'applied' | 'saved' | 'in_progress'
    };
    
    try {
      await JobStorageService.saveApplication(applicationData);
      
      // Check if we've reached the target application count for this session
      const sessionStartTime = context.sessionStartTime || 0;
      const sessionCount = await JobStorageService.getSessionApplicationCount(sessionStartTime);
      const targetCount = context.targetApplicationCount || Infinity;
      
      let msg2 = `Tracked application for ${position} at ${company} with status: ${applicationStatus}`;
      
      // Add session progress information to the message
      if (Number.isFinite(targetCount)) {
        msg2 += ` (${sessionCount}/${targetCount} applications completed)`;
        
        // If we've reached the target, add that information
        if (sessionCount >= targetCount) {
          msg2 += ". Target application count reached! Continuing to search for more jobs, you can manually stop the agent when satisfied.";
        }
      }
      
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
        // Don't mark as done even if target is reached, let the user stop manually
        isDone: false
      });
    } catch (error) {
      const errorMsg = `Failed to track application: ${error instanceof Error ? error.message : String(error)}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      return new ActionResult({
        error: errorMsg,
        includeInMemory: true,
      });
    }
  }, trackApplicationActionSchema);
}

export function createUploadResumeAction(context: any): Action {
  return new Action(async (input: { element_index: number, desc?: string }) => {
    const elementIndex = input.element_index;
    const description = input.desc || 'Uploading resume PDF';
    
    const msg = `${description} to file input field`;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, msg);

    try {
      const page = await context.browserContext.getCurrentPage();
      const state = await page.getState();
      const elementNode = state?.selectorMap.get(elementIndex);
      
      if (!elementNode) {
        throw new Error(`Element with index ${elementIndex} not found`);
      }
      
      // Check if element is a file input
      if (elementNode.tagName !== 'INPUT' || elementNode.attributes?.type !== 'file') {
        throw new Error(`Element with index ${elementIndex} is not a file input`);
      }
      
      // Get the resume PDF path from context
      const resumePdfPath = context.resumePdfPath;
      
      if (!resumePdfPath) {
        throw new Error('Resume PDF path not provided in context');
      }
      
      // Upload the file to the input
      await page.uploadFile(elementIndex, resumePdfPath);
      
      const msg2 = `Successfully uploaded resume PDF to the form`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const msg3 = `Failed to upload resume: ${errorMessage}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg3);
      
      return new ActionResult({
        error: msg3,
        includeInMemory: true,
      });
    }
  }, uploadResumeActionSchema);
}

// Helper function to extract form data from resume based on form type
function extractFormData(resume: string, formType: string): Record<string, string> {
  // Placeholder implementation - in a real implementation, you would parse the resume
  // For now, return empty object
  return {};
}

// Helper function to identify form fields from page state
function identifyFormFields(state: any, formType: string): Array<{elementIndex: number, fieldName: string}> {
  // Placeholder implementation - in a real implementation, you would analyze the DOM
  // For now, return empty array
  return [];
} 