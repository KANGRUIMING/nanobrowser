import { JobApplication } from '../types';
import { createLogger } from '@src/background/log';

const logger = createLogger('JobStorage');
const STORAGE_KEY = 'jobagent_applications';

/**
 * Service for managing job application storage
 */
export class JobStorageService {
  /**
   * Save a job application to storage
   * @param application The job application to save
   */
  static async saveApplication(application: JobApplication): Promise<void> {
    try {
      // Generate ID if not provided
      if (!application.id) {
        application.id = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      }

      // Get existing applications
      const applications = await this.getApplications();
      
      // Check if application with same URL already exists
      const existingIndex = applications.findIndex(app => 
        app.url === application.url && 
        app.company === application.company &&
        app.position === application.position
      );
      
      if (existingIndex >= 0) {
        // Update existing application
        applications[existingIndex] = {
          ...applications[existingIndex],
          ...application,
          date_applied: application.date_applied || new Date().toISOString()
        };
      } else {
        // Add new application
        applications.push({
          ...application,
          date_applied: application.date_applied || new Date().toISOString()
        });
      }
      
      // Save to Chrome storage
      await chrome.storage.local.set({ [STORAGE_KEY]: applications });
      logger.info(`Saved application for ${application.position} at ${application.company}`);
    } catch (error) {
      logger.error(`Failed to save application: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get all saved job applications
   * @returns Array of job applications
   */
  static async getApplications(): Promise<JobApplication[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] || [];
    } catch (error) {
      logger.error(`Failed to get applications: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Check if an application already exists for a job
   * @param company Company name
   * @param position Position title
   * @param url Job URL (optional)
   * @returns True if application exists
   */
  static async applicationExists(company: string, position: string, url?: string): Promise<boolean> {
    const applications = await this.getApplications();
    
    return applications.some(app => {
      // If URL is provided, match by URL
      if (url && app.url === url) {
        return true;
      }
      
      // Otherwise match by company and position
      return app.company.toLowerCase() === company.toLowerCase() && 
             app.position.toLowerCase() === position.toLowerCase();
    });
  }

  /**
   * Count applications in the current session
   * @param sessionStartTime The timestamp of when the session started
   * @returns Number of applications in the current session
   */
  static async getSessionApplicationCount(sessionStartTime: number): Promise<number> {
    const applications = await this.getApplications();
    
    // Filter applications applied after session started
    return applications.filter(app => {
      const appTime = new Date(app.date_applied).getTime();
      return appTime >= sessionStartTime;
    }).length;
  }

  /**
   * Clear all saved applications
   */
  static async clearApplications(): Promise<void> {
    try {
      await chrome.storage.local.remove(STORAGE_KEY);
      logger.info('Cleared all job applications');
    } catch (error) {
      logger.error(`Failed to clear applications: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
} 