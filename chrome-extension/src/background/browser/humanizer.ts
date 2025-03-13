import { createLogger } from '@src/background/log';
import type { ElementHandle } from 'puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js';
import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import type { KeyInput } from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';

const logger = createLogger('HumanInteraction');

/**
 * Provides methods that simulate human-like interactions with webpages
 * Designed to help bypass anti-bot measures by adding natural variability and delays
 */
export class HumanInteraction {
  /**
   * Returns a random integer between min and max (inclusive)
   */
  private static getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Returns a random float between min and max (inclusive)
   */
  private static getRandomFloat(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  /**
   * Wait for a random amount of time within a specified range
   * @param minMs Minimum wait time in milliseconds
   * @param maxMs Maximum wait time in milliseconds
   */
  public static async randomDelay(minMs = 200, maxMs = 1000): Promise<void> {
    const delay = this.getRandomInt(minMs, maxMs);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Generate a Bezier curve point for mouse movement
   * @param t Parameter between 0 and 1
   * @param p1 Start point
   * @param p2 Control point 1
   * @param p3 Control point 2
   * @param p4 End point
   */
  private static bezierPoint(
    t: number,
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    p4: { x: number; y: number },
  ): { x: number; y: number } {
    const cx = 3 * (p2.x - p1.x);
    const bx = 3 * (p3.x - p2.x) - cx;
    const ax = p4.x - p1.x - cx - bx;

    const cy = 3 * (p2.y - p1.y);
    const by = 3 * (p3.y - p2.y) - cy;
    const ay = p4.y - p1.y - cy - by;

    const x = ax * Math.pow(t, 3) + bx * Math.pow(t, 2) + cx * t + p1.x;
    const y = ay * Math.pow(t, 3) + by * Math.pow(t, 2) + cy * t + p1.y;

    return { x, y };
  }

  /**
   * Performs a human-like mouse movement to an element and clicks it
   * Uses a Bezier curve path with random micro-movements
   */
  public static async humanMouseClick(
    page: PuppeteerPage,
    element: ElementHandle,
    options: {
      pauseBeforeClick?: boolean;
      clickCount?: number;
      clickDelay?: number;
      safeMode?: boolean;
    } = {},
  ): Promise<void> {
    const { pauseBeforeClick = true, clickCount = 1, clickDelay = 50, safeMode = true } = options;

    try {
      // Mark the element with a data attribute to help with debugging and to prevent interference with DOM parsing
      if (safeMode) {
        try {
          await element.evaluate(el => {
            el.setAttribute('data-human-interaction', 'true');
          });
        } catch (e) {
          // Ignore errors when setting attributes - they're not critical
          logger.debug('Could not mark element with data attribute:', e);
        }
      }

      // Get the bounding box of the element
      const box = await element.boundingBox();
      if (!box) {
        throw new Error('Could not get element bounding box');
      }

      // Get the current mouse position or use a default
      const currentMouse = await page.evaluate(() => {
        return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      });

      // Calculate target click position (random point within element)
      const clickX = box.x + this.getRandomFloat(box.width * 0.2, box.width * 0.8);
      const clickY = box.y + this.getRandomFloat(box.height * 0.2, box.height * 0.8);

      // Generate random control points for the Bezier curve
      const offset = Math.min(box.width, box.height) * 0.5;
      const cp1 = {
        x: currentMouse.x + this.getRandomFloat(-offset, offset),
        y: currentMouse.y + this.getRandomFloat(-offset, offset),
      };
      const cp2 = {
        x: clickX + this.getRandomFloat(-offset, offset),
        y: clickY + this.getRandomFloat(-offset, offset),
      };

      // Move mouse along a Bezier curve path with micro-movements
      const steps = this.getRandomInt(10, 25); // Number of steps for mouse movement

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const point = this.bezierPoint(t, currentMouse, cp1, cp2, { x: clickX, y: clickY });

        // Add subtle micro-movements
        if (i > 0 && i < steps) {
          point.x += this.getRandomFloat(-2, 2);
          point.y += this.getRandomFloat(-2, 2);
        }

        await page.mouse.move(point.x, point.y);

        // Add random small delays between movements
        await this.randomDelay(8, 25);
      }

      // Occasionally pause before clicking (simulates human decision-making)
      if (pauseBeforeClick && Math.random() < 0.7) {
        await this.randomDelay(100, 500);
      }

      // Click the element
      for (let i = 0; i < clickCount; i++) {
        await page.mouse.down();
        await this.randomDelay(20, 50);
        await page.mouse.up();

        if (i < clickCount - 1) {
          await this.randomDelay(clickDelay, clickDelay + 50);
        }
      }

      // Remove marker attribute after interaction to leave DOM clean
      if (safeMode) {
        try {
          await element.evaluate(el => {
            el.removeAttribute('data-human-interaction');
          });
        } catch (e) {
          // Ignore cleanup errors
          logger.debug('Could not clean up data attribute:', e);
        }
      }

      logger.debug('Performed human-like mouse click');
    } catch (error) {
      logger.error('Failed to perform human mouse click:', error);
      throw new Error(`Human mouse click failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Types text in a human-like way with variable speed and occasional pauses
   */
  public static async humanType(
    page: PuppeteerPage,
    text: string,
    options: {
      minSpeed?: number;
      maxSpeed?: number;
      initialDelay?: boolean;
      mistakeProbability?: number;
    } = {},
  ): Promise<void> {
    const { minSpeed = 50, maxSpeed = 200, initialDelay = true, mistakeProbability = 0.03 } = options;

    try {
      // Initial delay before typing (like a human thinking)
      if (initialDelay) {
        await this.randomDelay(300, 1200);
      }

      // Occasionally select all and delete before typing (common human behavior)
      if (Math.random() < 0.2) {
        await page.keyboard.down('Control' as KeyInput);
        await page.keyboard.press('a' as KeyInput);
        await page.keyboard.up('Control' as KeyInput);
        await this.randomDelay(50, 200);
        await page.keyboard.press('Backspace' as KeyInput);
        await this.randomDelay(200, 500);
      }

      // Character typing loop
      for (let i = 0; i < text.length; i++) {
        const char = text[i];

        // Type the character
        await page.keyboard.press(char as KeyInput);

        // Speed varies by character and position in text
        let charDelay = this.getRandomInt(minSpeed, maxSpeed);

        // Slow down for punctuation
        if ('.,:;?!'.includes(char)) {
          charDelay += this.getRandomInt(100, 300);
        }

        // Occasional longer pauses (like human thinking)
        if (Math.random() < 0.05) {
          await this.randomDelay(300, 1200);
        } else {
          await this.randomDelay(charDelay / 2, charDelay);
        }

        // Simulate typos with backspace correction
        if (Math.random() < mistakeProbability && i < text.length - 1) {
          // Type a wrong character
          const wrongChar = String.fromCharCode(text.charCodeAt(i + 1) + this.getRandomInt(-2, 2));
          await page.keyboard.press(wrongChar as KeyInput);
          await this.randomDelay(200, 500);

          // Delete the mistake
          await page.keyboard.press('Backspace' as KeyInput);
          await this.randomDelay(200, 400);
        }
      }

      logger.debug('Completed human-like typing');
    } catch (error) {
      logger.error('Failed to perform human typing:', error);
      throw new Error(`Human typing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Performs a human-like scrolling behavior
   * Scrolls with variable speed and occasional pauses
   */
  public static async humanScroll(
    page: PuppeteerPage,
    direction: 'up' | 'down',
    options: {
      distance?: number;
      speed?: 'slow' | 'medium' | 'fast';
      smooth?: boolean;
    } = {},
  ): Promise<void> {
    const {
      distance = 0, // 0 means auto-calculate based on viewport
      speed = 'medium',
      smooth = true,
    } = options;

    try {
      // Calculate scroll distance if not specified
      let scrollDistance = distance;
      if (scrollDistance === 0) {
        scrollDistance = await page.evaluate(() => {
          return Math.floor(window.innerHeight * 0.7);
        });
      }

      // Adjust direction
      if (direction === 'up') {
        scrollDistance = -scrollDistance;
      }

      // Determine scroll parameters based on speed
      let steps, stepDelay;
      switch (speed) {
        case 'slow':
          steps = this.getRandomInt(15, 25);
          stepDelay = [30, 60];
          break;
        case 'fast':
          steps = this.getRandomInt(5, 10);
          stepDelay = [10, 30];
          break;
        default: // medium
          steps = this.getRandomInt(8, 15);
          stepDelay = [20, 40];
          break;
      }

      // Smooth scrolling (multiple small movements)
      if (smooth) {
        const stepSize = Math.floor(scrollDistance / steps);

        for (let i = 0; i < steps; i++) {
          // Random variation in each step
          const variation = this.getRandomFloat(0.8, 1.2);
          const currentStep = Math.floor(stepSize * variation);

          await page.evaluate(scrollY => {
            window.scrollBy(0, scrollY);
          }, currentStep);

          // Variable delay between scroll steps
          await this.randomDelay(stepDelay[0], stepDelay[1]);

          // Occasional pause during scrolling (like reading)
          if (Math.random() < 0.1) {
            await this.randomDelay(300, 2000);
          }
        }
      }
      // Quick scroll (single movement)
      else {
        await page.evaluate(scrollY => {
          window.scrollBy(0, scrollY);
        }, scrollDistance);
      }

      // Pause after scrolling (like reading content)
      await this.randomDelay(500, 2000);

      logger.debug(`Performed human-like ${direction} scroll`);
    } catch (error) {
      logger.error('Failed to perform human scrolling:', error);
      throw new Error(`Human scrolling failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Simulates human-like tab navigation using keyboard
   * Useful for navigating form fields
   */
  public static async humanTabNavigation(page: PuppeteerPage, tabCount: number): Promise<void> {
    try {
      for (let i = 0; i < tabCount; i++) {
        await page.keyboard.press('Tab' as KeyInput);
        await this.randomDelay(100, 500);
      }
      logger.debug(`Performed ${tabCount} human-like tab navigation steps`);
    } catch (error) {
      logger.error('Failed to perform tab navigation:', error);
      throw new Error(`Tab navigation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Adds randomized user behavior to simulate human browsing
   * Performs actions like random mouse movements, small scrolls, etc.
   */
  public static async addRandomBehavior(page: PuppeteerPage): Promise<void> {
    try {
      const randomAction = this.getRandomInt(1, 5);

      switch (randomAction) {
        // Random mouse movement
        case 1: {
          const { x, y } = await page.evaluate(() => {
            const x = Math.floor(Math.random() * window.innerWidth * 0.8) + window.innerWidth * 0.1;
            const y = Math.floor(Math.random() * window.innerHeight * 0.8) + window.innerHeight * 0.1;
            return { x, y };
          });

          // Move mouse with natural curve
          const steps = this.getRandomInt(5, 10);
          const currentPosition = await page.evaluate(() => {
            return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          });

          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const newX = currentPosition.x + (x - currentPosition.x) * t;
            const newY = currentPosition.y + (y - currentPosition.y) * t;
            await page.mouse.move(newX, newY);
            await this.randomDelay(10, 30);
          }
          break;
        }

        // Tiny scroll
        case 2: {
          const tinyScroll = this.getRandomInt(5, 40) * (Math.random() > 0.5 ? 1 : -1);
          await page.evaluate(scrollY => {
            window.scrollBy(0, scrollY);
          }, tinyScroll);
          break;
        }

        // Mouse wiggle (tiny movements like a human hand)
        case 3: {
          for (let i = 0; i < 3; i++) {
            await page.mouse.move(this.getRandomInt(-5, 5), this.getRandomInt(-5, 5));
            await this.randomDelay(10, 40);
          }
          break;
        }

        // Brief hover over a random element
        case 4: {
          const randomElement = await page.evaluate(() => {
            const elements = document.querySelectorAll('a, button, input, select');
            if (elements.length === 0) return null;

            const element = elements[Math.floor(Math.random() * elements.length)];
            const rect = element.getBoundingClientRect();
            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              width: rect.width,
              height: rect.height,
            };
          });

          if (randomElement) {
            const x = randomElement.x + this.getRandomFloat(-randomElement.width / 4, randomElement.width / 4);
            const y = randomElement.y + this.getRandomFloat(-randomElement.height / 4, randomElement.height / 4);
            await page.mouse.move(x, y);
            await this.randomDelay(100, 1000);
          }
          break;
        }

        // Do nothing (pause)
        case 5:
          await this.randomDelay(300, 2000);
          break;
      }

      logger.debug('Added random human-like behavior');
    } catch (error) {
      logger.error('Failed to add random behavior:', error);
      // Don't throw error since this is supplementary behavior
    }
  }
}
