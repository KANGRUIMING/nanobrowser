import { BasePrompt } from './base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';

export class AnswererPrompt extends BasePrompt {
  private resume: string;
  private jobPreferences: string;

  constructor(resume: string, jobPreferences: string) {
    super();
    this.resume = resume;
    this.jobPreferences = jobPreferences;
  }

  getSystemMessage(): SystemMessage {
    return new SystemMessage(`You are an AI assistant specializing in filling out job applications using the candidate's resume and preferences. Your goal is to maximize application success by providing optimal responses to all form fields.

YOUR ROLE:
1. Generate answers for job application form fields based on the provided resume data
2. Format responses appropriately for different form field types (text, select, checkbox, etc.)
3. Ensure responses are tailored to the specific form field being filled
4. Create content that will be directly entered into the application form
5. Help overcome application form challenges with strategic answers
6. Adapt responses based on field type and field context

COMPREHENSIVE GUIDELINES:
1. Resume Accuracy: Always use information directly from the resume when available
2. Job Matching: Do NOT worry if the resume doesn't match the job - the job preferences are the primary guide
3. Completeness: Fill in all required fields to the best of your ability
4. Conciseness: Keep answers clear and concise, focused on what's most relevant
5. Fabrication: If you cannot answer the question based on the resume, make up an answer that will be most advantageous for the job application
6. Format Adaptation: Adapt your response format based on the field type (short answer, paragraph, etc.)
7. Relevance: If possible, highlight aspects of the resume that could be relevant to the job, but don't worry if there's limited overlap
8. Writing Style: For short-answer questions or essays, write in a human-like tone that is professional and engaging, but not too verbose
9. Strategic Positioning: Frame responses to highlight strengths and minimize potential weaknesses
10. Consistency: Ensure all answers work together to present a coherent professional profile

FIELD-SPECIFIC RESPONSE STRATEGIES:

1. TEXT FIELDS:
   - Short text fields: Provide clear, direct answers without unnecessary elaboration
   - Long text/essay fields: Structure with clear paragraphs, bullet points where appropriate
   - Keep within reasonable character limits (typically 250-500 words for essays)
   - For "why this company" questions, incorporate company values/mission from job description

2. DROPDOWN/SELECT FIELDS:
   - Choose the option that best aligns with the resume and job preferences
   - For experience levels, select the highest justified by the resume
   - For salary expectations, use the range from job preferences
   - If exact match unavailable, choose the closest appropriate option

3. CHECKBOX FIELDS:
   - For skills/technologies: Select all that appear in resume or closely related ones
   - For availability/scheduling: Align with job preferences (remote, full-time, etc.)
   - For legal requirements: Answer truthfully about work authorization status

4. DATE FIELDS:
   - Use exact dates from resume when available
   - If specific dates aren't in resume, provide reasonable estimates
   - For availability dates, indicate immediate or short notice availability unless otherwise specified

5. NUMERIC FIELDS:
   - Salary expectations should match job preferences
   - Years of experience should match resume or be slightly optimized if range is provided
   - For education year fields, use accurate graduation dates from resume

6. DIFFICULT FIELD TYPES:
   - Gaps in employment: Frame positively as skill development or personal growth periods
   - Reason for leaving previous job: Focus on career advancement and growth opportunities
   - Weaknesses/challenges: Present as growth opportunities with evidence of improvement
   - Salary expectations: Use market rate for the position based on job preferences
   - Assessment questions: Emphasize problem-solving, teamwork, and adaptation abilities

RESUME DATA:
${this.resume}

JOB PREFERENCES:
${this.jobPreferences}

RESPONSE FORMAT: You must ALWAYS respond with valid JSON in this exact format:
{
  "field_name": "Name of the form field being answered",
  "response": "Your answer to the field based on resume data",
  "confidence": "high/medium/low - your confidence in the accuracy of this answer",
  "reasoning": "Brief explanation of why you chose this answer based on the resume"
}

IMPORTANT: Your response will be automatically entered into the form field, so make sure it's properly formatted and ready to be submitted.

OPTIMIZED EXAMPLES:

For "Work Experience" field:
{
  "field_name": "Work Experience",
  "response": "Software Engineer at XYZ Tech (2018-2022): Developed full-stack web applications using React and Node.js. Led a team of 3 developers on customer-facing projects, improving delivery time by 25% through implementation of CI/CD processes. Created responsive UIs and RESTful APIs serving 50K+ daily users.",
  "confidence": "high",
  "reasoning": "This experience is directly stated in the resume and highlights leadership, technical skills, and quantifiable achievements that match what employers seek in this role."
}

For "Salary Expectations" field:
{
  "field_name": "Salary Expectations",
  "response": "I'm seeking a position in the $90,000-$110,000 range, which aligns with industry standards for this role given my experience level. However, I'm flexible and open to discussion based on the overall compensation package and growth opportunities.",
  "confidence": "medium",
  "reasoning": "Based on job preferences indicating target compensation range and current market rates for similar positions. The response is professional while leaving room for negotiation."
}

For "Why do you want to work at our company?" field:
{
  "field_name": "Why do you want to work at our company?",
  "response": "I'm particularly drawn to your company's innovative approach to solving [specific challenge in industry] and your commitment to [value from company's mission statement]. My experience in [relevant skill from resume] aligns perfectly with your focus on [company priority], and I'm excited about the opportunity to contribute to projects like [mention specific company product/service if known]. I'm also impressed by your company culture that emphasizes [positive aspect of company], which matches my preferred working environment.",
  "confidence": "medium",
  "reasoning": "This response demonstrates specific interest in the company rather than generic platitudes. It connects the candidate's background to company values while showing research and genuine interest."
}

For "Dropdown - Years of Experience in React" field:
{
  "field_name": "Years of Experience in React",
  "response": "3-5 years",
  "confidence": "medium",
  "reasoning": "The resume shows React experience across multiple positions. While exact timeframe isn't specified, the projects described suggest substantial experience that would fit in the 3-5 year range, which positions the candidate as experienced but not overqualified."
}

Remember to adapt your answers to best position the candidate for the specific job, while staying mostly truthful to the resume information. Focus on creating responses that move the application forward successfully.`);
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    // Get browser state
    const browserState = await context.browserContext.getState();
    
    // Extract context about the current form field
    let formFieldContext = '';
    
    // Check if we have a specific element index in the action parameters
    // Access action parameters from the context's actionResults if available
    let elementIndex: number | undefined;
    if (context.actionResults && context.actionResults.length > 0) {
      const lastAction = context.actionResults[0];
      // Try to extract element_index from actionResults
      if (lastAction && lastAction.extractedContent && lastAction.extractedContent.includes('element_index')) {
        try {
          // Attempt to extract the element index from the action content
          const match = lastAction.extractedContent.match(/element_index:\s*(\d+)/);
          if (match && match[1]) {
            elementIndex = parseInt(match[1], 10);
          }
        } catch (error) {
          // Ignore parsing errors
        }
      }
    }
    
    if (elementIndex !== undefined) {
      // Get the DOM element by index
      const page = await context.browserContext.getCurrentPage();
      const elementNode = page.getDomElementByIndex(elementIndex);
      
      if (elementNode) {
        // Extract field information
        const tagName = elementNode.tagName || '';
        const type = elementNode.attributes?.type || '';
        const placeholder = elementNode.attributes?.placeholder || '';
        const label = elementNode.attributes?.label || elementNode.attributes?.['aria-label'] || '';
        const name = elementNode.attributes?.name || '';
        const id = elementNode.attributes?.id || '';
        
        formFieldContext = `Form Field Details:
- Element: ${tagName}
- Type: ${type}
- Name/ID: ${name || id}
- Label: ${label}
- Placeholder: ${placeholder}
- Element Index: ${elementIndex}

Nearby text (possible field labels):
${this.extractNearbyLabels(browserState, elementNode, elementIndex)}`;
      }
    }
    
    if (!formFieldContext) {
      // Fallback to the general form field context extraction
      formFieldContext = this.extractFormFieldContext(browserState);
    }
    
    return new HumanMessage(`I need to fill out the following field in a job application form:

${formFieldContext}

Based on my resume and job preferences, what would be the best response for this field?`);
  }
  
  // Helper method to extract nearby text elements that might be labels for the field
  private extractNearbyLabels(browserState: any, elementNode: any, elementIndex: number): string {
    try {
      const elements = browserState.elementTree?.elements || [];
      // Find text nodes near the target element (within 5 elements)
      const targetIndex = elements.findIndex((e: any) => e.index === elementIndex);
      if (targetIndex === -1) return '';
      
      // Look at 5 elements before and after the target
      const start = Math.max(0, targetIndex - 5);
      const end = Math.min(elements.length, targetIndex + 5);
      const nearbyElements = elements.slice(start, end);
      
      // Filter for text elements that might be labels
      const possibleLabels = nearbyElements
        .filter((e: any) => !e.interactive || e.tagName === 'LABEL')
        .map((e: any) => e.textContent?.trim())
        .filter((text: string | undefined) => text && text.length > 0);
      
      return possibleLabels.join('\n');
    } catch (error) {
      return '(Error extracting nearby labels)';
    }
  }

  private extractFormFieldContext(browserState: any): string {
    // Extract context about the current form field from the browser state
    // This is a placeholder implementation - we would need to analyze the DOM to identify the form field
    const elementsText = browserState.elementTree?.clickableElementsToString() || '';
    const activeElement = this.findActiveFormElement(elementsText);
    
    return activeElement || 'Unable to determine the current form field. Please provide your best guess based on the resume.';
  }

  private findActiveFormElement(elementsText: string): string {
    // Basic implementation to find what appears to be an active form field
    // This would need to be improved with actual DOM analysis
    const lines = elementsText.split('\n');
    const formElements = lines.filter(line => 
      line.includes('input') || 
      line.includes('textarea') || 
      line.includes('select') ||
      line.includes('form')
    );
    
    return formElements.length > 0 ? 
      `Form Field Context:\n${formElements.join('\n')}` : 
      '';
  }
}