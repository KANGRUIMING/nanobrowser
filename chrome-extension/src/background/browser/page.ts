import 'webextension-polyfill';
import {
  connect,
  ExtensionTransport,
  type HTTPRequest,
  type HTTPResponse,
  type ProtocolType,
  type KeyInput,
} from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import type { Browser } from 'puppeteer-core/lib/esm/puppeteer/api/Browser.js';
import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import type { ElementHandle } from 'puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js';
import type { Frame } from 'puppeteer-core/lib/esm/puppeteer/api/Frame.js';
import {
  getClickableElements as _getClickableElements,
  removeHighlights as _removeHighlights,
  getScrollInfo as _getScrollInfo,
  getMarkdownContent as _getMarkdownContent,
  getReadabilityContent as _getReadabilityContent,
  type ReadabilityResult,
} from '../dom/service';
import { DOMElementNode, type DOMState, DOMTextNode } from '../dom/views';
import { type BrowserContextConfig, DEFAULT_BROWSER_CONTEXT_CONFIG, type PageState } from './types';
import { createLogger } from '@src/background/log';
import { HumanInteraction } from './humanizer';

const logger = createLogger('Page');

declare global {
  interface Window {
    turn2Markdown: (selector?: string) => string;
  }
}

export function build_initial_state(tabId?: number, url?: string, title?: string): PageState {
  return {
    elementTree: new DOMElementNode({
      tagName: 'root',
      isVisible: true,
      parent: null,
      xpath: '',
      attributes: {},
      children: [],
    }),
    selectorMap: new Map(),
    tabId: tabId || 0,
    url: url || '',
    title: title || '',
    screenshot: null,
    pixelsAbove: 0,
    pixelsBelow: 0,
  };
}

export default class Page {
  private _tabId: number;
  private _initialUrl: string;
  private _initialTitle: string;
  private _state: PageState;
  private _validWebPage = false;
  private _attached = false;
  private _browser: Browser | null = null;
  private _puppeteerPage: PuppeteerPage | null = null;
  private _config: BrowserContextConfig;
  private _stealthModeEnabled: boolean = false;
  private _stealthLevel: 'low' | 'medium' | 'high' = 'medium';

  constructor(tabId: number, url: string, title: string, config: BrowserContextConfig) {
    this._tabId = tabId;
    this._initialUrl = url;
    this._initialTitle = title;
    this._state = build_initial_state(tabId, url, title);
    this._config = config;
    // chrome://newtab/, chrome://newtab/extensions are not valid web pages, can't be attached
    this._validWebPage = (tabId && url && url.startsWith('http')) || false;
  }

  get tabId(): number {
    return this._tabId;
  }

  get validWebPage(): boolean {
    return this._validWebPage;
  }

  get attached(): boolean {
    return this._validWebPage && this._puppeteerPage !== null;
  }

  async attachPuppeteer(): Promise<boolean> {
    if (!this._validWebPage) {
      return false;
    }

    if (this._puppeteerPage) {
      return true;
    }

    logger.info('attaching puppeteer', this._tabId);
    const browser = await connect({
      transport: await ExtensionTransport.connectTab(this._tabId),
      defaultViewport: null,
      protocol: 'cdp' as ProtocolType,
    });
    this._browser = browser;

    const [page] = await browser.pages();
    this._puppeteerPage = page;

    // Add anti-detection scripts
    await this._addAntiDetectionScripts();

    return true;
  }

  private async _addAntiDetectionScripts(): Promise<void> {
    if (!this._puppeteerPage) {
      return;
    }

    await this._puppeteerPage.evaluateOnNewDocument(`
      // Webdriver property - Hide automation
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // Chrome runtime - Make Chrome detection pass
      window.chrome = { 
        runtime: {},
        app: {},
        loadTimes: function() {},
        csi: function() {},
        runtime: {
          connect: function() {},
          sendMessage: function() {},
          onMessage: {
            addListener: function() {},
            removeListener: function() {}
          }
        }
      };

      // Permissions - Make permission queries more natural
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // Prevent canvas fingerprinting from being too perfect by adding subtle noise
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      
      // Add subtle noise to canvas fingerprinting
      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        // Call the original function
        const result = originalToDataURL.apply(this, arguments);
        
        // Only add noise to images larger than 16x16 (avoid breaking UI elements)
        if (this.width > 16 && this.height > 16 && 
            !this.getAttribute('data-noccanvas')) {
          // Small chances of no modification to avoid breaking functionality
          if (Math.random() < 0.92) {
            return result;
          }
          
          // Create a data URL with a slight modification
          try {
            const context = this.getContext('2d');
            if (context) {
              // Add one slightly modified pixel at a random location
              const x = Math.floor(Math.random() * this.width);
              const y = Math.floor(Math.random() * this.height);
              const imgData = context.getImageData(x, y, 1, 1);
              
              // Add subtle noise to one random component
              const component = Math.floor(Math.random() * 3);
              imgData.data[component] = Math.max(0, Math.min(255, 
                imgData.data[component] + (Math.random() < 0.5 ? 1 : -1)
              ));
              
              context.putImageData(imgData, x, y);
              return originalToDataURL.apply(this, arguments);
            }
          } catch (e) {
            // If modification fails, return original
            console.error("Error modifying canvas data", e);
          }
        }
        
        return result;
      };

      // Modified getImageData to add subtle random noise
      CanvasRenderingContext2D.prototype.getImageData = function() {
        const imageData = originalGetImageData.apply(this, arguments);
        
        // Only add noise in specific cases to avoid breaking UI
        if (arguments[2] > 16 && arguments[3] > 16 && 
            !this.canvas.getAttribute('data-nocanvas')) {
          
          // Small chance of modification to avoid breaking functionality
          if (Math.random() < 0.92) {
            return imageData;
          }
          
          // Add slight variation to a few random pixels
          const numPixelsToModify = Math.floor(Math.random() * 3) + 1;
          
          for (let i = 0; i < numPixelsToModify; i++) {
            const pixelIndex = Math.floor(Math.random() * (imageData.data.length / 4)) * 4;
            const component = Math.floor(Math.random() * 3);
            
            // Ensure modification is very subtle
            imageData.data[pixelIndex + component] = Math.max(0, Math.min(255, 
              imageData.data[pixelIndex + component] + (Math.random() < 0.5 ? 1 : -1)
            ));
          }
        }
        
        return imageData;
      };

      // Make shadow DOM always accessible for content extraction
      (function () {
        const originalAttachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function attachShadow(options) {
          return originalAttachShadow.call(this, { ...options, mode: "open" });
        };
      })();
      
      // Audio fingerprinting protection
      const audioContextProto = window.AudioContext || window.webkitAudioContext;
      if (audioContextProto) {
        const origCreateOscillator = audioContextProto.prototype.createOscillator;
        audioContextProto.prototype.createOscillator = function() {
          const oscillator = origCreateOscillator.apply(this, arguments);
          const origGetFrequency = oscillator.frequency.value;
          Object.defineProperty(oscillator.frequency, 'value', {
            get: function() { 
              return origGetFrequency + (Math.random() * 0.0001);
            }
          });
          return oscillator;
        };
      }
      
      // Override navigator properties with realistic values
      if (!window.navigator.originalUserAgent) {
        // Store original values
        window.navigator.originalUserAgent = window.navigator.userAgent;
        window.navigator.originalAppVersion = window.navigator.appVersion;
        window.navigator.originalPlatform = window.navigator.platform;
        window.navigator.originalVendor = window.navigator.vendor;
      }
    `);
  }

  async detachPuppeteer(): Promise<void> {
    if (this._browser) {
      await this._browser.disconnect();
      this._browser = null;
      this._puppeteerPage = null;
      // reset the state
      this._state = build_initial_state(this._tabId);
    }
  }

  async removeHighlight(): Promise<void> {
    if (this._config.highlightElements && this._validWebPage) {
      await _removeHighlights(this._tabId);
    }
  }

  async getClickableElements(focusElement: number): Promise<DOMState | null> {
    if (!this._validWebPage) {
      return null;
    }
    return _getClickableElements(
      this._tabId,
      this._config.highlightElements,
      focusElement,
      this._config.viewportExpansion,
    );
  }

  // Get scroll position information for the current page.
  async getScrollInfo(): Promise<[number, number]> {
    if (!this._validWebPage) {
      return [0, 0];
    }
    return _getScrollInfo(this._tabId);
  }

  async getContent(): Promise<string> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    return await this._puppeteerPage.content();
  }

  async getMarkdownContent(selector?: string): Promise<string> {
    if (!this._validWebPage) {
      return '';
    }
    return _getMarkdownContent(this._tabId, selector);
  }

  async getReadabilityContent(): Promise<ReadabilityResult> {
    if (!this._validWebPage) {
      return {
        title: this._initialTitle || 'Invalid Page',
        content: 'This page cannot be parsed for content',
        textContent: 'This page cannot be parsed for content',
        length: 0,
        excerpt: 'Invalid page - cannot parse content',
        byline: '',
        dir: '',
        siteName: '',
        lang: '',
        publishedTime: '',
      };
    }

    try {
      return await _getReadabilityContent(this._tabId);
    } catch (error) {
      logger.error('Could not get readability content', error);
      // Return a default ReadabilityResult object instead of a string
      return {
        title: this._initialTitle || 'Error',
        content: `Error extracting content: ${error instanceof Error ? error.message : String(error)}`,
        textContent: `Error extracting content: ${error instanceof Error ? error.message : String(error)}`,
        length: 0,
        excerpt: 'Error extracting content',
        byline: '',
        dir: '',
        siteName: '',
        lang: '',
        publishedTime: '',
      };
    }
  }

  async getState(): Promise<PageState> {
    if (!this._validWebPage) {
      // return the initial state
      return build_initial_state(this._tabId);
    }
    await this.waitForPageAndFramesLoad();
    const state = await this._updateState();
    return state;
  }

  async _updateState(useVision = true, focusElement = -1): Promise<PageState> {
    try {
      // Test if page is still accessible
      // @ts-expect-error - puppeteerPage is not null, already checked before calling this function
      await this._puppeteerPage.evaluate('1');
    } catch (error) {
      logger.warning('Current page is no longer accessible:', error);
      if (this._browser) {
        const pages = await this._browser.pages();
        if (pages.length > 0) {
          this._puppeteerPage = pages[0];
        } else {
          throw new Error('Browser closed: no valid pages available');
        }
      }
    }

    try {
      await this.removeHighlight();

      // Get DOM content (equivalent to dom_service.get_clickable_elements)
      // This part would need to be implemented based on your DomService logic
      const content = await this.getClickableElements(focusElement);
      if (!content) {
        logger.warning('Failed to get clickable elements');
        // Return last known good state if available
        return this._state;
      }
      // log the attributes of content object
      if ('selectorMap' in content) {
        logger.debug('content.selectorMap:', content.selectorMap.size);
      } else {
        logger.debug('content.selectorMap: not found');
      }
      if ('elementTree' in content) {
        logger.debug('content.elementTree:', content.elementTree?.tagName);
      } else {
        logger.debug('content.elementTree: not found');
      }

      // Take screenshot if needed
      const screenshot = useVision ? await this.takeScreenshot() : null;
      const [pixelsAbove, pixelsBelow] = await this.getScrollInfo();

      // update the state
      this._state.elementTree = content.elementTree;
      this._state.selectorMap = content.selectorMap;
      this._state.url = this._puppeteerPage?.url() || '';
      this._state.title = (await this._puppeteerPage?.title()) || '';
      this._state.screenshot = screenshot;
      this._state.pixelsAbove = pixelsAbove;
      this._state.pixelsBelow = pixelsBelow;
      return this._state;
    } catch (error) {
      logger.error('Failed to update state:', error);
      // Return last known good state if available
      return this._state;
    }
  }

  async takeScreenshot(fullPage = false): Promise<string | null> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    try {
      // First disable animations/transitions
      await this._puppeteerPage.evaluate(() => {
        const styleId = 'puppeteer-disable-animations';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            *, *::before, *::after {
              animation: none !important;
              transition: none !important;
            }
          `;
          document.head.appendChild(style);
        }
      });

      // Take the screenshot using JPEG format with 80% quality
      const screenshot = await this._puppeteerPage.screenshot({
        fullPage: fullPage,
        encoding: 'base64',
        type: 'jpeg',
        quality: 80, // Good balance between quality and file size
      });

      // Clean up the style element
      await this._puppeteerPage.evaluate(() => {
        const style = document.getElementById('puppeteer-disable-animations');
        if (style) {
          style.remove();
        }
      });

      return screenshot as string;
    } catch (error) {
      logger.error('Failed to take screenshot:', error);
      throw error;
    }
  }

  url(): string {
    if (this._puppeteerPage) {
      return this._puppeteerPage.url();
    }
    return this._state.url;
  }

  async title(): Promise<string> {
    if (this._puppeteerPage) {
      return await this._puppeteerPage.title();
    }
    return this._state.title;
  }

  async navigateTo(url: string): Promise<void> {
    if (!this._puppeteerPage) {
      return;
    }
    logger.info('navigateTo', url);

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goto(url)]);
      logger.info('navigateTo complete');
    } catch (error) {
      // Check if it's a timeout error
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Navigation timeout, but page might still be usable:', error);
        // You might want to check if the page is actually loaded despite the timeout
      } else {
        logger.error('Navigation failed:', error);
        throw error; // Re-throw non-timeout errors
      }
    }
  }

  async refreshPage(): Promise<void> {
    if (!this._puppeteerPage) return;

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.reload()]);
      logger.info('Page refresh complete');
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Refresh timeout, but page might still be usable:', error);
      } else {
        logger.error('Page refresh failed:', error);
        throw error;
      }
    }
  }

  async goBack(): Promise<void> {
    if (!this._puppeteerPage) return;

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goBack()]);
      logger.info('Navigation back completed');
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Back navigation timeout, but page might still be usable:', error);
      } else {
        logger.error('Could not navigate back:', error);
        throw error;
      }
    }
  }

  async goForward(): Promise<void> {
    if (!this._puppeteerPage) return;

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goForward()]);
      logger.info('Navigation forward completed');
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Forward navigation timeout, but page might still be usable:', error);
      } else {
        logger.error('Could not navigate forward:', error);
        throw error;
      }
    }
  }

  async scrollDown(amount?: number): Promise<void> {
    if (this._puppeteerPage) {
      // Use human-like scrolling behavior
      await HumanInteraction.humanScroll(this._puppeteerPage, 'down', {
        distance: amount,
        speed: amount ? 'medium' : 'slow',
        smooth: true,
      });

      // Add occasional random behavior after scrolling
      if (Math.random() < 0.3) {
        await HumanInteraction.addRandomBehavior(this._puppeteerPage);
      }
    }
  }

  async scrollUp(amount?: number): Promise<void> {
    if (this._puppeteerPage) {
      // Use human-like scrolling behavior
      await HumanInteraction.humanScroll(this._puppeteerPage, 'up', {
        distance: amount,
        speed: amount ? 'medium' : 'slow',
        smooth: true,
      });

      // Add occasional random behavior after scrolling
      if (Math.random() < 0.3) {
        await HumanInteraction.addRandomBehavior(this._puppeteerPage);
      }
    }
  }

  async sendKeys(keys: string): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    // Split combination keys (e.g., "Control+A" or "Shift+ArrowLeft")
    const keyParts = keys.split('+');

    if (keyParts.length === 1) {
      // For single keys, add natural timing
      try {
        // Occasionally add random behavior before key press
        if (Math.random() < 0.2) {
          await HumanInteraction.addRandomBehavior(this._puppeteerPage);
        }

        await HumanInteraction.randomDelay(50, 300);
        await this._puppeteerPage.keyboard.press(this._convertKey(keyParts[0]));
        await HumanInteraction.randomDelay(20, 200);

        logger.info('sendKeys complete', keys);
      } catch (error) {
        logger.error('Failed to send keys:', error);
        throw new Error(`Failed to send keys: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // For key combinations, use the original implementation but with human-like delays
      const modifiers = keyParts.slice(0, -1);
      const mainKey = keyParts[keyParts.length - 1];

      try {
        // Add random delay before key combination
        await HumanInteraction.randomDelay(100, 400);

        // Press all modifier keys with small delays in between
        for (const modifier of modifiers) {
          await this._puppeteerPage.keyboard.down(this._convertKey(modifier));
          await HumanInteraction.randomDelay(20, 100);
        }

        // Press the main key
        await this._puppeteerPage.keyboard.press(this._convertKey(mainKey));
        await HumanInteraction.randomDelay(50, 150);

        // Release all modifier keys in reverse order
        for (const modifier of [...modifiers].reverse()) {
          await this._puppeteerPage.keyboard.up(this._convertKey(modifier));
          await HumanInteraction.randomDelay(10, 50);
        }

        // Wait for any potential reactions to the key press
        await this.waitForPageAndFramesLoad();
        logger.info('sendKeys complete', keys);
      } catch (error) {
        logger.error('Failed to send keys:', error);
        throw new Error(`Failed to send keys: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private _convertKey(key: string): KeyInput {
    const lowerKey = key.trim().toLowerCase();
    const keyMap: { [key: string]: string } = {
      // Letters
      a: 'KeyA',
      b: 'KeyB',
      c: 'KeyC',
      d: 'KeyD',
      e: 'KeyE',
      f: 'KeyF',
      g: 'KeyG',
      h: 'KeyH',
      i: 'KeyI',
      j: 'KeyJ',
      k: 'KeyK',
      l: 'KeyL',
      m: 'KeyM',
      n: 'KeyN',
      o: 'KeyO',
      p: 'KeyP',
      q: 'KeyQ',
      r: 'KeyR',
      s: 'KeyS',
      t: 'KeyT',
      u: 'KeyU',
      v: 'KeyV',
      w: 'KeyW',
      x: 'KeyX',
      y: 'KeyY',
      z: 'KeyZ',

      // Numbers
      '0': 'Digit0',
      '1': 'Digit1',
      '2': 'Digit2',
      '3': 'Digit3',
      '4': 'Digit4',
      '5': 'Digit5',
      '6': 'Digit6',
      '7': 'Digit7',
      '8': 'Digit8',
      '9': 'Digit9',

      // Special keys
      control: 'Control',
      shift: 'Shift',
      alt: 'Alt',
      meta: 'Meta',
      enter: 'Enter',
      backspace: 'Backspace',
      delete: 'Delete',
      arrowleft: 'ArrowLeft',
      arrowright: 'ArrowRight',
      arrowup: 'ArrowUp',
      arrowdown: 'ArrowDown',
      escape: 'Escape',
      tab: 'Tab',
      space: 'Space',
    };

    const convertedKey = keyMap[lowerKey] || key;
    logger.info('convertedKey', convertedKey);
    return convertedKey as KeyInput;
  }

  async scrollToText(text: string): Promise<boolean> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    try {
      // Try different locator strategies
      const selectors = [
        // Using text selector (equivalent to get_by_text)
        `::-p-text(${text})`,
        // Using XPath selector (contains text) - case insensitive
        `::-p-xpath(//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')])`,
      ];

      for (const selector of selectors) {
        try {
          const element = await this._puppeteerPage.$(selector);
          if (element) {
            // Check if element is visible
            const isVisible = await element.evaluate(el => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            });

            if (isVisible) {
              await this._scrollIntoViewIfNeeded(element);
              await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll to complete
              return true;
            }
          }
        } catch (e) {
          logger.debug(`Locator attempt failed: ${e}`);
        }
      }
      return false;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  async getDropdownOptions(index: number): Promise<Array<{ index: number; text: string; value: string }>> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap?.get(index);

    if (!element || !this._puppeteerPage) {
      throw new Error('Element not found or puppeteer is not connected');
    }

    try {
      // Get the element handle using the element's selector
      const elementHandle = await this.locateElement(element);
      if (!elementHandle) {
        throw new Error('Dropdown element not found');
      }

      // Evaluate the select element to get all options
      const options = await elementHandle.evaluate(select => {
        if (!(select instanceof HTMLSelectElement)) {
          throw new Error('Element is not a select element');
        }

        return Array.from(select.options).map(option => ({
          index: option.index,
          text: option.text, // Not trimming to maintain exact match for selection
          value: option.value,
        }));
      });

      if (!options.length) {
        throw new Error('No options found in dropdown');
      }

      return options;
    } catch (error) {
      throw new Error(`Failed to get dropdown options: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async selectDropdownOption(index: number, text: string): Promise<string> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap?.get(index);

    if (!element || !this._puppeteerPage) {
      throw new Error('Element not found or puppeteer is not connected');
    }

    logger.debug(`Attempting to select '${text}' from dropdown`);
    logger.debug(`Element attributes: ${JSON.stringify(element.attributes)}`);
    logger.debug(`Element tag: ${element.tagName}`);

    // Validate that we're working with a select element
    if (element.tagName?.toLowerCase() !== 'select') {
      const msg = `Cannot select option: Element with index ${index} is a ${element.tagName}, not a SELECT`;
      logger.error(msg);
      throw new Error(msg);
    }

    try {
      // Get the element handle using the element's selector
      const elementHandle = await this.locateElement(element);
      if (!elementHandle) {
        throw new Error(`Dropdown element with index ${index} not found`);
      }

      // Verify dropdown and select option in one call
      const result = await elementHandle.evaluate(
        (select, optionText, elementIndex) => {
          if (!(select instanceof HTMLSelectElement)) {
            return {
              found: false,
              message: `Element with index ${elementIndex} is not a SELECT`,
            };
          }

          const options = Array.from(select.options);
          const option = options.find(opt => opt.text.trim() === optionText);

          if (!option) {
            const availableOptions = options.map(o => o.text.trim()).join('", "');
            return {
              found: false,
              message: `Option "${optionText}" not found in dropdown element with index ${elementIndex}. Available options: "${availableOptions}"`,
            };
          }

          // Set the value and dispatch events
          const previousValue = select.value;
          select.value = option.value;

          // Only dispatch events if the value actually changed
          if (previousValue !== option.value) {
            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.dispatchEvent(new Event('input', { bubbles: true }));
          }

          return {
            found: true,
            message: `Selected option "${optionText}" with value "${option.value}"`,
          };
        },
        text,
        index,
      );

      logger.debug('Selection result:', result);
      // whether found or not, return the message
      return result.message;
    } catch (error) {
      const errorMessage = `${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  async locateElement(element: DOMElementNode): Promise<ElementHandle | null> {
    if (!this._puppeteerPage) {
      // throw new Error('Puppeteer page is not connected');
      logger.warning('Puppeteer is not connected');
      return null;
    }
    let currentFrame: PuppeteerPage | Frame = this._puppeteerPage;

    // Start with the target element and collect all parents
    const parents: DOMElementNode[] = [];
    let current = element;
    while (current.parent) {
      parents.push(current.parent);
      current = current.parent;
    }

    // Process all iframe parents in sequence (in reverse order - top to bottom)
    const iframes = parents.reverse().filter(item => item.tagName === 'iframe');
    for (const parent of iframes) {
      const cssSelector = parent.enhancedCssSelectorForElement(this._config.includeDynamicAttributes);
      const frameElement: ElementHandle | null = await currentFrame.$(cssSelector);
      if (!frameElement) {
        // throw new Error(`Could not find iframe with selector: ${cssSelector}`);
        logger.warning(`Could not find iframe with selector: ${cssSelector}`);
        return null;
      }
      const frame: Frame | null = await frameElement.contentFrame();
      if (!frame) {
        // throw new Error(`Could not access frame content for selector: ${cssSelector}`);
        logger.warning(`Could not access frame content for selector: ${cssSelector}`);
        return null;
      }
      currentFrame = frame;
    }

    const cssSelector = element.enhancedCssSelectorForElement(this._config.includeDynamicAttributes);

    try {
      const elementHandle: ElementHandle | null = await currentFrame.$(cssSelector);
      if (elementHandle) {
        // Scroll element into view if needed
        await this._scrollIntoViewIfNeeded(elementHandle);
        return elementHandle;
      }
    } catch (error) {
      logger.error('Failed to locate element:', error);
    }

    return null;
  }

  async inputTextElementNode(useVision: boolean, elementNode: DOMElementNode, text: string): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    try {
      // Highlight before typing - this must be done first to update the DOM state
      if (elementNode.highlightIndex !== undefined) {
        try {
          await this._updateState(useVision, elementNode.highlightIndex);
        } catch (stateUpdateError) {
          console.warn('Failed to update DOM state, continuing with input:', stateUpdateError);
          // Continue with input operation even if highlighting fails
        }
      }

      // Apply stealth behavior after updating the DOM state
      if (this._stealthModeEnabled) {
        await this.applyStealthBehavior();
      }

      // First try standard element location
      let element = await this.locateElement(elementNode);

      // If element not found using standard methods, try fallback approaches
      if (!element) {
        console.log('Input element not found with standard locator, trying fallback methods...');

        // Try various fallback methods to locate the element
        element = await this._fallbackElementLocation(elementNode);

        if (!element) {
          throw new Error(
            `Input element: ${elementNode.tagName} (${elementNode.xpath}) not found after fallback attempts`,
          );
        }
      }

      // Scroll element into view if needed
      try {
        await this._scrollIntoViewIfNeeded(element);
      } catch (scrollError) {
        console.warn('Failed to scroll element into view:', scrollError);
        // Continue anyway
      }

      // Handle clicks and typing differently based on stealth mode
      try {
        if (this._stealthModeEnabled) {
          // Click the element with human-like movement first
          await HumanInteraction.humanMouseClick(this._puppeteerPage, element);

          // Clear the input field
          await element.evaluate(el => {
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });

          // Type with human-like timing and occasional mistakes
          // Increase mistake probability in high stealth mode
          const mistakeProbability = this._stealthModeEnabled && this._stealthLevel === 'high' ? 0.07 : 0.03;
          await HumanInteraction.humanType(this._puppeteerPage, text, { mistakeProbability });
        } else {
          // Original method for typing (more reliable)
          // Clear the input field first
          await element.evaluate(el => {
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });

          // Type the text directly
          await element.type(text);
        }
      } catch (typingError) {
        console.warn('Standard typing methods failed, trying fallback typing:', typingError);

        // Try alternative typing methods
        try {
          // First alternative: Focus and type directly
          await element.focus();
          await this._puppeteerPage.keyboard.type(text);
        } catch (focusTypeError) {
          console.warn('Focus and type failed, trying JS typing:', focusTypeError);

          // Second alternative: Try JavaScript typing
          await element.evaluate((el, inputText) => {
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              // Set value and trigger events
              el.value = inputText;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, text);
        }
      }

      // Wait for potential auto-suggestions or dynamic content to load
      await HumanInteraction.randomDelay(300, 800);
    } catch (error) {
      console.error('All input methods failed, trying direct DOM manipulation:', error);

      // Last resort: Try direct DOM manipulation using xpath
      if (elementNode.xpath && elementNode.xpath.length > 0) {
        try {
          await this._puppeteerPage.evaluate(
            (xpath, inputText) => {
              try {
                // Find element by xpath
                const getElementByXPath = (path: string) => {
                  const result = document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                  return result.singleNodeValue;
                };

                const element = getElementByXPath(xpath);

                // Set value if it's an input or textarea
                if (element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
                  element.value = inputText;
                  element.dispatchEvent(new Event('input', { bubbles: true }));
                  element.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                }

                return false;
              } catch (e) {
                console.error('Error in direct DOM input:', e);
                return false;
              }
            },
            elementNode.xpath,
            text,
          );
        } catch (finalError) {
          throw new Error(`All input attempts failed: ${error}`);
        }
      } else {
        throw new Error(
          `Failed to input text into element: ${elementNode.tagName}. Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async _scrollIntoViewIfNeeded(element: ElementHandle, timeout = 2500): Promise<void> {
    const startTime = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Check if element is in viewport
      const isVisible = await element.evaluate(el => {
        const rect = el.getBoundingClientRect();

        // Check if element has size
        if (rect.width === 0 || rect.height === 0) return false;

        // Check if element is hidden
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
          return false;
        }

        // Check if element is in viewport
        const isInViewport =
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
          rect.right <= (window.innerWidth || document.documentElement.clientWidth);

        if (!isInViewport) {
          // Scroll into view if not visible
          el.scrollIntoView({
            behavior: 'auto',
            block: 'center',
            inline: 'center',
          });
          return false;
        }

        return true;
      });

      if (isVisible) break;

      // Check timeout
      if (Date.now() - startTime > timeout) {
        throw new Error('Timed out while trying to scroll element into view');
      }

      // Small delay before next check
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async clickElementNode(useVision: boolean, elementNode: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    try {
      // Highlight before clicking - this must be done first to update the DOM state
      if (elementNode.highlightIndex !== undefined) {
        try {
          await this._updateState(useVision, elementNode.highlightIndex);
        } catch (stateUpdateError) {
          console.warn('Failed to update DOM state, continuing with click:', stateUpdateError);
          // Continue with click operation even if highlighting fails
        }
      }

      // Apply stealth behavior after updating the DOM state
      if (this._stealthModeEnabled) {
        await this.applyStealthBehavior();
      }

      // First try standard element location
      let element = await this.locateElement(elementNode);

      // If element not found using standard methods, try fallback approaches
      if (!element) {
        console.log('Element not found with standard locator, trying fallback methods...');

        // Try various fallback methods to locate the element
        element = await this._fallbackElementLocation(elementNode);

        if (!element) {
          throw new Error(`Element: ${elementNode.tagName} (${elementNode.xpath}) not found after fallback attempts`);
        }
      }

      // Add random human-like behavior before clicking (only if stealth mode enabled)
      if (this._stealthModeEnabled && Math.random() < 0.7) {
        await HumanInteraction.addRandomBehavior(this._puppeteerPage);
      }

      // Use human-like mouse movement and clicking if stealth mode is enabled,
      // otherwise fall back to the original more reliable click method
      if (this._stealthModeEnabled) {
        await HumanInteraction.humanMouseClick(this._puppeteerPage, element);
      } else {
        // Original clicking method
        try {
          // First attempt: Use Puppeteer's click method with timeout
          await Promise.race([
            element.click(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 2000)),
          ]);
        } catch (clickError) {
          console.warn('Standard click failed, trying alternative click methods:', clickError);

          try {
            // Second attempt: Try scrolling into view first
            await this._scrollIntoViewIfNeeded(element);
            await element.click();
          } catch (scrollClickError) {
            console.warn('Scroll and click failed, trying click via JS:', scrollClickError);

            try {
              // Third attempt: Use JavaScript click as last resort
              await this._puppeteerPage.evaluate(el => {
                el.click();
              }, element);
            } catch (jsClickError) {
              // Final attempt: Try a direct DOM click using coordinates
              const box = await element.boundingBox();
              if (box) {
                await this._puppeteerPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              } else {
                throw new Error('Failed to click element: No bounding box available');
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error clicking element:', error);

      // Try one last direct approach if everything else fails
      if (elementNode.xpath && elementNode.xpath.length > 0) {
        try {
          // Attempt to click by using direct DOM access via xpath or element properties
          await this._puppeteerPage.evaluate(xpath => {
            try {
              const getElementByXPath = (path: string) => {
                const result = document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return result.singleNodeValue;
              };

              // Try to find by xpath
              let element = getElementByXPath(xpath);

              // If not found and the xpath has an ID, try using getElementById
              if (!element && xpath.includes('id=')) {
                const idMatch = xpath.match(/id=["']([^"']*)["']/);
                if (idMatch && idMatch[1]) {
                  element = document.getElementById(idMatch[1]);
                }
              }

              // If element found, click it
              if (element) {
                // Use dispatchEvent for more universal compatibility
                const clickEvent = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                });
                element.dispatchEvent(clickEvent);
                return true;
              }

              return false;
            } catch (e) {
              console.error('Error in click evaluation:', e);
              return false;
            }
          }, elementNode.xpath);
        } catch (lastAttemptError) {
          throw new Error(`All click attempts failed: ${error}`);
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Attempts to locate an element using alternative methods when standard location fails
   * This is particularly useful for sites that block script injection
   */
  private async _fallbackElementLocation(elementNode: DOMElementNode): Promise<ElementHandle | null> {
    console.log('Using fallback element location methods...');

    try {
      // Try 1: Use standard Puppeteer selectors if we have reliable attributes
      if (elementNode.attributes && elementNode.attributes.id) {
        // ID is most reliable
        const idSelector = `#${CSS.escape(elementNode.attributes.id)}`;
        try {
          const element = await this._puppeteerPage!.$(idSelector);
          if (element) {
            console.log(`Found element by ID: ${idSelector}`);
            return element;
          }
        } catch (idError) {
          console.warn(`Failed to find element by ID: ${idError}`);
        }
      }

      // Try 2: If we have coordinates, use them to find the element
      if (
        elementNode.viewportCoordinates &&
        elementNode.viewportCoordinates.center &&
        elementNode.viewportCoordinates.center.x !== undefined &&
        elementNode.viewportCoordinates.center.y !== undefined
      ) {
        try {
          // Use coordinates to find element
          const x = elementNode.viewportCoordinates.center.x;
          const y = elementNode.viewportCoordinates.center.y;

          // Get element at position using JavaScript
          const elementAtPoint = await this._puppeteerPage!.evaluateHandle(
            (x, y) => {
              const element = document.elementFromPoint(x, y);
              return element;
            },
            x,
            y,
          );

          if (elementAtPoint) {
            const asElement = elementAtPoint.asElement();
            if (asElement) {
              console.log(`Found element at coordinates (${x}, ${y})`);
              return asElement;
            }
          }
        } catch (coordError) {
          console.warn(`Failed to find element by coordinates: ${coordError}`);
        }
      }

      // Try 3: Use a combination of tag name, attributes, and text content
      if (elementNode.tagName) {
        try {
          // Create an array of possible attributes to match
          const attrSelectors: string[] = [];

          if (elementNode.attributes) {
            // Add class selector if available
            if (elementNode.attributes.class) {
              const classNames = elementNode.attributes.class
                .split(/\s+/)
                .filter(c => c && !c.includes(':'))
                .map(c => `.${CSS.escape(c)}`)
                .join('');
              if (classNames) {
                attrSelectors.push(`${elementNode.tagName}${classNames}`);
              }
            }

            // Add name attribute if available
            if (elementNode.attributes.name) {
              attrSelectors.push(`${elementNode.tagName}[name="${CSS.escape(elementNode.attributes.name)}"]`);
            }

            // Add other useful attributes
            const usefulAttrs = ['type', 'role', 'aria-label', 'placeholder', 'href', 'title'];
            for (const attr of usefulAttrs) {
              if (elementNode.attributes[attr]) {
                attrSelectors.push(`${elementNode.tagName}[${attr}="${CSS.escape(elementNode.attributes[attr])}"]`);
              }
            }
          }

          // Add generic tagname as last resort
          attrSelectors.push(elementNode.tagName);

          // Try each selector
          for (const selector of attrSelectors) {
            try {
              const elements = await this._puppeteerPage!.$$(selector);

              // If we have text content, use it to find the right element
              if (elements.length > 0 && elementNode.children && elementNode.children.length > 0) {
                // Get text from first text node child
                const textNodes = elementNode.children.filter(child => child instanceof DOMTextNode);
                if (textNodes.length > 0) {
                  const targetText = (textNodes[0] as DOMTextNode).text.trim();

                  if (targetText) {
                    // Find element with matching text
                    for (const element of elements) {
                      const elementText = await this._puppeteerPage!.evaluate(
                        el => el.textContent?.trim() || '',
                        element,
                      );
                      if (elementText.includes(targetText) || targetText.includes(elementText)) {
                        console.log(`Found element by selector "${selector}" and matching text: "${targetText}"`);
                        return element;
                      }
                    }
                  }
                }
              }

              // If no text match, just return the first element
              if (elements.length > 0) {
                console.log(`Found element by selector: ${selector}`);
                return elements[0];
              }
            } catch (selectorError) {
              console.warn(`Failed to find element by selector "${selector}": ${selectorError}`);
            }
          }
        } catch (tagError) {
          console.warn(`Failed to find element by tag combinations: ${tagError}`);
        }
      }

      // Try 4: Use XPath as last resort
      if (elementNode.xpath) {
        try {
          // Format XPath for Puppeteer
          const formattedXPath = elementNode.xpath.startsWith('//')
            ? elementNode.xpath
            : `//${elementNode.xpath.replace(/^\/+/, '')}`;

          // Use the document.evaluate method directly via evaluate
          const element = await this._puppeteerPage!.evaluateHandle(xpath => {
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return result.singleNodeValue;
          }, formattedXPath);

          if (element) {
            const asElement = element.asElement();
            if (asElement) {
              console.log(`Found element by XPath: ${formattedXPath}`);
              return asElement;
            }
          }
        } catch (xpathError) {
          console.warn(`Failed to find element by XPath: ${xpathError}`);
        }
      }

      return null;
    } catch (error) {
      console.error('All fallback location methods failed:', error);
      return null;
    }
  }

  getSelectorMap(): Map<number, DOMElementNode> {
    return this._state.selectorMap;
  }

  async getElementByIndex(index: number): Promise<ElementHandle | null> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap.get(index);
    if (!element) return null;
    return await this.locateElement(element);
  }

  getDomElementByIndex(index: number): DOMElementNode | null {
    const selectorMap = this.getSelectorMap();
    return selectorMap.get(index) || null;
  }

  isFileUploader(elementNode: DOMElementNode, maxDepth = 3, currentDepth = 0): boolean {
    if (currentDepth > maxDepth) {
      return false;
    }

    // Check current element
    if (elementNode.tagName === 'input') {
      // Check for file input attributes
      const attributes = elementNode.attributes;
      // biome-ignore lint/complexity/useLiteralKeys: <explanation>
      if (attributes['type']?.toLowerCase() === 'file' || !!attributes['accept']) {
        return true;
      }
    }

    // Recursively check children
    if (elementNode.children && currentDepth < maxDepth) {
      for (const child of elementNode.children) {
        if ('tagName' in child) {
          // DOMElementNode type guard
          if (this.isFileUploader(child as DOMElementNode, maxDepth, currentDepth + 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  async waitForPageLoadState(timeout?: number) {
    const timeoutValue = timeout || 8000;
    await this._puppeteerPage?.waitForNavigation({ timeout: timeoutValue });
  }

  private async _waitForStableNetwork() {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    const RELEVANT_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'script', 'iframe']);

    const RELEVANT_CONTENT_TYPES = new Set([
      'text/html',
      'text/css',
      'application/javascript',
      'image/',
      'font/',
      'application/json',
    ]);

    const IGNORED_URL_PATTERNS = new Set([
      // Analytics and tracking
      'analytics',
      'tracking',
      'telemetry',
      'beacon',
      'metrics',
      // Ad-related
      'doubleclick',
      'adsystem',
      'adserver',
      'advertising',
      // Social media widgets
      'facebook.com/plugins',
      'platform.twitter',
      'linkedin.com/embed',
      // Live chat and support
      'livechat',
      'zendesk',
      'intercom',
      'crisp.chat',
      'hotjar',
      // Push notifications
      'push-notifications',
      'onesignal',
      'pushwoosh',
      // Background sync/heartbeat
      'heartbeat',
      'ping',
      'alive',
      // WebRTC and streaming
      'webrtc',
      'rtmp://',
      'wss://',
      // Common CDNs
      'cloudfront.net',
      'fastly.net',
    ]);

    const pendingRequests = new Set();
    let lastActivity = Date.now();

    const onRequest = (request: HTTPRequest) => {
      // Filter by resource type
      const resourceType = request.resourceType();
      if (!RELEVANT_RESOURCE_TYPES.has(resourceType)) {
        return;
      }

      // Filter out streaming, websocket, and other real-time requests
      if (['websocket', 'media', 'eventsource', 'manifest', 'other'].includes(resourceType)) {
        return;
      }

      // Filter out by URL patterns
      const url = request.url().toLowerCase();
      if (Array.from(IGNORED_URL_PATTERNS).some(pattern => url.includes(pattern))) {
        return;
      }

      // Filter out data URLs and blob URLs
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        return;
      }

      // Filter out requests with certain headers
      const headers = request.headers();
      if (
        // biome-ignore lint/complexity/useLiteralKeys: <explanation>
        headers['purpose'] === 'prefetch' ||
        headers['sec-fetch-dest'] === 'video' ||
        headers['sec-fetch-dest'] === 'audio'
      ) {
        return;
      }

      pendingRequests.add(request);
      lastActivity = Date.now();
    };

    const onResponse = (response: HTTPResponse) => {
      const request = response.request();
      if (!pendingRequests.has(request)) {
        return;
      }

      // Filter by content type
      const contentType = response.headers()['content-type']?.toLowerCase() || '';

      // Skip streaming content
      if (
        ['streaming', 'video', 'audio', 'webm', 'mp4', 'event-stream', 'websocket', 'protobuf'].some(t =>
          contentType.includes(t),
        )
      ) {
        pendingRequests.delete(request);
        return;
      }

      // Only process relevant content types
      if (!Array.from(RELEVANT_CONTENT_TYPES).some(ct => contentType.includes(ct))) {
        pendingRequests.delete(request);
        return;
      }

      // Skip large responses
      const contentLength = response.headers()['content-length'];
      if (contentLength && Number.parseInt(contentLength) > 5 * 1024 * 1024) {
        // 5MB
        pendingRequests.delete(request);
        return;
      }

      pendingRequests.delete(request);
      lastActivity = Date.now();
    };

    // Add event listeners
    this._puppeteerPage.on('request', onRequest);
    this._puppeteerPage.on('response', onResponse);

    try {
      const startTime = Date.now();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const now = Date.now();
        const timeSinceLastActivity = (now - lastActivity) / 1000; // Convert to seconds

        if (pendingRequests.size === 0 && timeSinceLastActivity >= this._config.waitForNetworkIdlePageLoadTime) {
          break;
        }

        const elapsedTime = (now - startTime) / 1000; // Convert to seconds
        if (elapsedTime > this._config.maximumWaitPageLoadTime) {
          console.debug(
            `Network timeout after ${this._config.maximumWaitPageLoadTime}s with ${pendingRequests.size} pending requests:`,
            Array.from(pendingRequests).map(r => (r as HTTPRequest).url()),
          );
          break;
        }
      }
    } finally {
      // Clean up event listeners
      this._puppeteerPage.off('request', onRequest);
      this._puppeteerPage.off('response', onResponse);
    }
    console.debug(`Network stabilized for ${this._config.waitForNetworkIdlePageLoadTime} seconds`);
  }

  async waitForPageAndFramesLoad(timeoutOverwrite?: number): Promise<void> {
    // Start timing
    const startTime = Date.now();

    // Wait for page load
    try {
      await this._waitForStableNetwork();
    } catch (error) {
      console.warn('Page load failed, continuing...');
    }

    // Calculate remaining time to meet minimum wait time
    const elapsed = (Date.now() - startTime) / 1000; // Convert to seconds
    const minWaitTime = timeoutOverwrite || this._config.minimumWaitPageLoadTime;
    const remaining = Math.max(minWaitTime - elapsed, 0);

    console.debug(
      `--Page loaded in ${elapsed.toFixed(2)} seconds, waiting for additional ${remaining.toFixed(2)} seconds`,
    );

    // Sleep remaining time if needed
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining * 1000)); // Convert seconds to milliseconds
    }
  }

  async waitForNetworkStable(): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    // Add additional wait time for stealth mode
    const additionalDelay = this._stealthModeEnabled
      ? this._stealthLevel === 'high'
        ? 1.5
        : this._stealthLevel === 'medium'
          ? 1.0
          : 0.5
      : 0;

    const RELEVANT_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'script', 'iframe']);

    const RELEVANT_CONTENT_TYPES = new Set([
      'text/html',
      'text/css',
      'application/javascript',
      'image/',
      'font/',
      'application/json',
    ]);

    const IGNORED_URL_PATTERNS = new Set([
      // Analytics and tracking
      'analytics',
      'tracking',
      'telemetry',
      'beacon',
      'metrics',
      // Ad-related
      'doubleclick',
      'adsystem',
      'adserver',
      'advertising',
      // Social media widgets
      'facebook.com/plugins',
      'platform.twitter',
      'linkedin.com/embed',
      // Live chat and support
      'livechat',
      'zendesk',
      'intercom',
      'crisp.chat',
      'hotjar',
      // Push notifications
      'push-notifications',
      'onesignal',
      'pushwoosh',
      // Background sync/heartbeat
      'heartbeat',
      'ping',
      'alive',
      // WebRTC and streaming
      'webrtc',
      'rtmp://',
      'wss://',
      // Common CDNs
      'cloudfront.net',
      'fastly.net',
    ]);

    const pendingRequests = new Set();
    let lastActivity = Date.now();
    let documentComplete = false;

    // Flag to track if load event has fired
    let loadFired = false;

    // Set up load event listener
    const loadListener = () => {
      loadFired = true;
      lastActivity = Date.now();
    };

    try {
      // Listen for the load event
      this._puppeteerPage.once('load', loadListener);

      const onRequest = (request: HTTPRequest) => {
        // Filter by resource type
        const resourceType = request.resourceType();
        if (!RELEVANT_RESOURCE_TYPES.has(resourceType)) {
          return;
        }

        // Special handling for document resources
        if (resourceType === 'document') {
          documentComplete = false;
        }

        // Filter out streaming, websocket, and other real-time requests
        if (['websocket', 'media', 'eventsource', 'manifest', 'other'].includes(resourceType)) {
          return;
        }

        // Filter out by URL patterns
        const url = request.url().toLowerCase();
        if (Array.from(IGNORED_URL_PATTERNS).some(pattern => url.includes(pattern))) {
          return;
        }

        // Filter out data URLs and blob URLs
        if (url.startsWith('data:') || url.startsWith('blob:')) {
          return;
        }

        // Filter out requests with certain headers
        const headers = request.headers();
        if (
          // biome-ignore lint/complexity/useLiteralKeys: <explanation>
          headers['purpose'] === 'prefetch' ||
          headers['sec-fetch-dest'] === 'video' ||
          headers['sec-fetch-dest'] === 'audio'
        ) {
          return;
        }

        pendingRequests.add(request);
        lastActivity = Date.now();
      };

      const onResponse = (response: HTTPResponse) => {
        const request = response.request();
        if (!pendingRequests.has(request)) {
          return;
        }

        // Mark document as complete when main document finishes loading
        if (request.resourceType() === 'document') {
          documentComplete = true;
        }

        // Filter by content type
        const contentType = response.headers()['content-type']?.toLowerCase() || '';

        // Skip streaming content
        if (
          ['streaming', 'video', 'audio', 'webm', 'mp4', 'event-stream', 'websocket', 'protobuf'].some(t =>
            contentType.includes(t),
          )
        ) {
          pendingRequests.delete(request);
          return;
        }

        // Only process relevant content types
        if (!Array.from(RELEVANT_CONTENT_TYPES).some(ct => contentType.includes(ct))) {
          pendingRequests.delete(request);
          return;
        }

        // Skip large responses
        const contentLength = response.headers()['content-length'];
        if (contentLength && Number.parseInt(contentLength) > 5 * 1024 * 1024) {
          // 5MB
          pendingRequests.delete(request);
          return;
        }

        pendingRequests.delete(request);
        lastActivity = Date.now();
      };

      // Add event listeners
      this._puppeteerPage.on('request', onRequest);
      this._puppeteerPage.on('response', onResponse);

      try {
        const startTime = Date.now();
        const waitTimeWithStealth = this._config.waitForNetworkIdlePageLoadTime + additionalDelay;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          // In stealth mode, use random delay intervals to appear more human-like
          const interval = this._stealthModeEnabled ? 50 + Math.floor(Math.random() * 100) : 100;

          await new Promise(resolve => setTimeout(resolve, interval));

          const now = Date.now();
          const timeSinceLastActivity = (now - lastActivity) / 1000; // Convert to seconds
          const elapsedTime = (now - startTime) / 1000; // Convert to seconds

          // Consider network stable when all of these conditions are true:
          // 1. No pending requests OR adequate time since last activity
          // 2. Document is complete (for main document navigations)
          // 3. Load event has fired or adequate time has passed
          const isStable =
            (pendingRequests.size === 0 || timeSinceLastActivity >= waitTimeWithStealth) &&
            (documentComplete || elapsedTime > waitTimeWithStealth / 2) &&
            (loadFired || elapsedTime > waitTimeWithStealth);

          if (isStable) {
            // Add a small final delay when in stealth mode to mimic human attention span
            if (this._stealthModeEnabled) {
              const humanDelay =
                this._stealthLevel === 'high'
                  ? Math.floor(Math.random() * 1000) + 500
                  : this._stealthLevel === 'medium'
                    ? Math.floor(Math.random() * 500) + 200
                    : Math.floor(Math.random() * 300) + 100;
              await new Promise(resolve => setTimeout(resolve, humanDelay));
            }
            break;
          }

          if (elapsedTime > this._config.maximumWaitPageLoadTime + additionalDelay) {
            console.debug(
              `Network timeout after ${this._config.maximumWaitPageLoadTime + additionalDelay}s with ${pendingRequests.size} pending requests:`,
              Array.from(pendingRequests).map(r => (r as HTTPRequest).url()),
            );
            break;
          }
        }
      } finally {
        // Clean up event listeners
        this._puppeteerPage.off('request', onRequest);
        this._puppeteerPage.off('response', onResponse);
        this._puppeteerPage.off('load', loadListener);
      }
      console.debug(`Network stabilized for ${this._config.waitForNetworkIdlePageLoadTime + additionalDelay} seconds`);
    } catch (error) {
      console.error('Error waiting for network to stabilize:', error);
      // Don't throw, just continue as we don't want this to break the flow
    }
  }

  /**
   * Enable or disable stealth mode for more human-like interactions
   * @param enabled Whether stealth mode should be enabled
   * @param level Protection level (low, medium, high)
   */
  public setStealthMode(enabled: boolean, level: 'low' | 'medium' | 'high' = 'medium'): void {
    this._stealthModeEnabled = enabled;
    this._stealthLevel = level;
    logger.info(`Page ${this._tabId}: Stealth mode ${enabled ? 'enabled' : 'disabled'} with ${level} protection level`);
  }

  /**
   * Get current stealth mode settings
   */
  public getStealthMode(): { enabled: boolean; level: 'low' | 'medium' | 'high' } {
    return {
      enabled: this._stealthModeEnabled,
      level: this._stealthLevel,
    };
  }

  /**
   * Apply random delays and behaviors based on current stealth settings
   */
  private async applyStealthBehavior(): Promise<void> {
    if (!this._stealthModeEnabled || !this._puppeteerPage) return;

    // Apply different behaviors based on stealth level
    switch (this._stealthLevel) {
      case 'low':
        // Just add a random delay
        await HumanInteraction.randomDelay(200, 800);
        break;

      case 'medium':
        // Add random delay and sometimes random mouse movement
        await HumanInteraction.randomDelay(300, 1200);
        if (Math.random() < 0.5) {
          await HumanInteraction.addRandomBehavior(this._puppeteerPage);
        }
        break;

      case 'high':
        // Add longer random delay and more complex behaviors
        await HumanInteraction.randomDelay(500, 2000);
        await HumanInteraction.addRandomBehavior(this._puppeteerPage);

        // Sometimes add a second random behavior
        if (Math.random() < 0.3) {
          await HumanInteraction.randomDelay(100, 500);
          await HumanInteraction.addRandomBehavior(this._puppeteerPage);
        }
        break;
    }
  }

  /**
   * Scrolls to the specified element
   * @param elementNode Element to scroll to
   */
  async scrollToElement(elementNode: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    if (!elementNode) {
      throw new Error('Element is null or undefined');
    }

    // Get appropriate selector from the DOM element node
    const selector = elementNode.xpath;
    if (!selector) {
      throw new Error('No valid xpath found for element');
    }

    try {
      const element = await this._puppeteerPage.$(selector);

      if (!element) {
        throw new Error(`Element not found with selector "${selector}"`);
      }

      // If stealth mode is enabled, use human-like scrolling
      if (this._stealthModeEnabled) {
        // Get element position
        const boundingBox = await element.boundingBox();
        if (!boundingBox) {
          throw new Error('Could not get element bounding box');
        }

        // Get viewport information
        const viewportInfo = await this._puppeteerPage.evaluate(() => {
          return {
            height: window.innerHeight,
            scrollY: window.scrollY,
          };
        });

        // Calculate target position (element should be in viewport, but not at the very top)
        const targetY = boundingBox.y - viewportInfo.height * 0.3; // Position element at 30% from top of viewport
        const currentY = viewportInfo.scrollY;
        const distance = targetY - currentY;

        if (Math.abs(distance) < 50) {
          // Element is already nearly in view, just small adjustment
          await this._puppeteerPage.evaluate(y => {
            window.scrollTo({
              top: y,
              behavior: 'smooth',
            });
          }, targetY);

          // Small random delay
          await HumanInteraction.randomDelay(200, 500);
          return;
        }

        // Determine scroll direction and approximate number of scroll actions needed
        const direction = distance > 0 ? 'down' : 'up';
        const viewportHeight = viewportInfo.height;
        const scrollsNeeded = Math.ceil(Math.abs(distance) / (viewportHeight * 0.7));

        // Perform multiple scroll actions to reach the element
        for (let i = 0; i < scrollsNeeded; i++) {
          await HumanInteraction.humanScroll(this._puppeteerPage, direction, {
            distance: Math.min(500, Math.abs(distance) / scrollsNeeded),
            speed: this._stealthLevel === 'high' ? 'slow' : 'medium',
            smooth: true,
          });

          // Check if element is now visible after each scroll
          const isVisible = await this._puppeteerPage.evaluate(sel => {
            const el = document.evaluate(
              sel,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null,
            ).singleNodeValue;
            if (!el) return false;

            const rect = (el as Element).getBoundingClientRect();
            return rect.top >= 0 && rect.top <= window.innerHeight;
          }, selector);

          if (isVisible) break;
        }

        // Fine tune the scroll position to center the element
        await element.evaluate(el => {
          el.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center',
          });
        });

        // Extra delay after scrolling to simulate reading or looking for the element
        const readingDelay =
          this._stealthLevel === 'high'
            ? Math.floor(Math.random() * 2000) + 1000
            : this._stealthLevel === 'medium'
              ? Math.floor(Math.random() * 1000) + 500
              : Math.floor(Math.random() * 500) + 200;

        await HumanInteraction.randomDelay(readingDelay, readingDelay + 300);
      } else {
        // Without stealth mode, just scroll element into view
        await element.evaluate(el => {
          el.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center',
          });
        });
      }
    } catch (error) {
      console.error(
        `Error scrolling to element with selector "${selector}"`,
        error instanceof Error ? error.message : String(error),
      );
      // Try the direct JavaScript approach as a fallback
      try {
        await this._puppeteerPage.evaluate(sel => {
          const el = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (el) {
            (el as Element).scrollIntoView({
              block: 'center',
              inline: 'center',
              behavior: 'smooth',
            });
          }
        }, selector);
      } catch (fallbackError) {
        console.error('Fallback scroll also failed:', fallbackError);
        throw new Error(`Failed to scroll to element: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
