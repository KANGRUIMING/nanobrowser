import { createLogger } from '@src/background/log';
import type { BuildDomTreeArgs, RawDomTreeNode } from './raw_types';
import { type DOMState, type DOMBaseNode, DOMElementNode, DOMTextNode } from './views';

const logger = createLogger('DOMService');

export interface ReadabilityResult {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string;
  dir: string;
  siteName: string;
  lang: string;
  publishedTime: string;
}

declare global {
  interface Window {
    buildDomTree: (args: BuildDomTreeArgs) => RawDomTreeNode | null;
    turn2Markdown: (selector?: string) => string;
    parserReadability: () => ReadabilityResult | null;
  }
}

/**
 * Get the scroll information for the current page.
 * @param tabId - The ID of the tab to get the scroll information for.
 * @returns A tuple containing the number of pixels above and below the current scroll position.
 */
export async function getScrollInfo(tabId: number): Promise<[number, number]> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      const scroll_y = window.scrollY;
      const viewport_height = window.innerHeight;
      const total_height = document.documentElement.scrollHeight;
      return {
        pixels_above: scroll_y,
        pixels_below: total_height - (scroll_y + viewport_height),
      };
    },
  });

  const result = results[0]?.result;
  if (!result) {
    throw new Error('Failed to get scroll information');
  }
  return [result.pixels_above, result.pixels_below];
}

/**
 * Get the markdown content for the current page.
 * @param tabId - The ID of the tab to get the markdown content for.
 * @param selector - The selector to get the markdown content for. If not provided, the body of the entire page will be converted to markdown.
 * @returns The markdown content for the selected element on the current page.
 */
export async function getMarkdownContent(tabId: number, selector?: string): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: sel => {
      return window.turn2Markdown(sel);
    },
    args: [selector || ''], // Pass the selector as an argument
  });

  const result = results[0]?.result;
  if (!result) {
    throw new Error('Failed to get markdown content');
  }
  return result as string;
}

/**
 * Get the readability content for the current page.
 * @param tabId - The ID of the tab to get the readability content for.
 * @returns The readability content for the current page.
 */
export async function getReadabilityContent(tabId: number): Promise<ReadabilityResult> {
  try {
    // First try with our custom parser
    try {
      // Ensure the script is injected before calling it
      const scriptResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => Object.prototype.hasOwnProperty.call(window, 'parserReadability'),
      });

      // If script not found, inject it first
      if (!scriptResults[0]?.result) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['parserReadability.js'],
        });
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          try {
            const result = window.parserReadability();
            if (result) return result;

            // Generate default object if parser returns null
            return {
              title: document.title || '',
              content: document.body?.innerHTML || '',
              textContent: document.body?.textContent || '',
              length: document.body?.textContent?.length || 0,
              excerpt: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
              byline: '',
              dir: document.dir || '',
              siteName: document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || '',
              lang: document.documentElement.lang || '',
              publishedTime:
                document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || '',
            };
          } catch (err) {
            console.error('Error in parserReadability:', err);
            return null;
          }
        },
      });

      const result = results[0]?.result;
      if (result) {
        return result as ReadabilityResult;
      }
    } catch (injectionError) {
      console.warn('Script injection for readability failed:', injectionError);
      // Continue to fallback method
    }

    // FALLBACK: Use native Chrome APIs to extract content without script injection
    console.log('Using fallback DOM extraction method for sites that block script injection');

    // Get page title and basic metadata
    const titleResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        title: document.title,
        url: window.location.href,
        lang: document.documentElement.lang || 'en',
      }),
    });

    const basicInfo = titleResult[0]?.result || { title: '', url: '', lang: 'en' };

    // Get page content using a simple DOM extraction approach
    const contentResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Helper function to safely get text content
        const safeTextContent = (el: Element | null): string => {
          if (!el) return '';
          try {
            return el.textContent || '';
          } catch (e) {
            return '';
          }
        };

        // Helper to extract metadata
        const getMeta = (name: string): string => {
          const meta = document.querySelector(
            `meta[name="${name}"], meta[property="${name}"], meta[property="og:${name}"]`,
          );
          return meta ? meta.getAttribute('content') || '' : '';
        };

        // Helper to generate a simple XPath
        const generateSimpleXPath = (el: Element): string => {
          if (!el || !el.parentElement) return '';

          const tagName = el.tagName.toLowerCase();

          if (el.id) {
            return `//${tagName}[@id="${el.id}"]`;
          }

          // Get the element's position among siblings of same type
          let count = 1;
          let sibling = el.previousElementSibling;
          while (sibling) {
            if (sibling.tagName === el.tagName) count++;
            sibling = sibling.previousElementSibling;
          }

          // Create a simple path segment
          return `${generateSimpleXPath(el.parentElement)}/${tagName}[${count}]`;
        };

        // Extract main content (avoiding common non-content areas)
        let mainContent = '';
        let textContent = '';

        try {
          // Try to find main content area
          const contentElements = [
            document.querySelector('article'),
            document.querySelector('main'),
            document.querySelector('[role="main"]'),
            document.querySelector('#content'),
            document.querySelector('.content'),
            document.body, // fallback
          ].filter(Boolean) as Element[]; // Type assertion after filtering nulls

          if (contentElements.length > 0) {
            const mainElement = contentElements[0];
            mainContent = mainElement.innerHTML || '';
            textContent = safeTextContent(mainElement);
          } else {
            // If no content elements found, use body
            mainContent = document.body.innerHTML || '';
            textContent = document.body.textContent || '';
          }

          // Get basic meta info without complex processing
          return {
            contentHtml: mainContent,
            textContent: textContent,
            description: getMeta('description'),
            siteName: getMeta('site_name') || document.domain,
            publishedTime: getMeta('article:published_time') || getMeta('published_time') || getMeta('date'),
          };
        } catch (e) {
          // Super safe fallback if everything else fails
          console.error('Error extracting content:', e);
          return {
            contentHtml: document.documentElement.outerHTML || '',
            textContent: document.documentElement.textContent || '',
            description: '',
            siteName: document.domain,
            publishedTime: '',
          };
        }
      },
    });

    const pageContent = contentResult[0]?.result || {
      contentHtml: '',
      textContent: '',
      description: '',
      siteName: '',
      publishedTime: '',
    };

    // Create a ReadabilityResult from the basic extracted content
    return {
      title: basicInfo.title,
      content: pageContent.contentHtml,
      textContent: pageContent.textContent,
      length: pageContent.textContent.length,
      excerpt: pageContent.description.substring(0, 200),
      byline: '',
      dir: 'ltr',
      siteName: pageContent.siteName,
      lang: basicInfo.lang,
      publishedTime: pageContent.publishedTime,
    };
  } catch (error) {
    console.error('All DOM extraction methods failed:', error);
    // Return default ReadabilityResult on any error
    return {
      title: '',
      content: '',
      textContent: '',
      length: 0,
      excerpt: '',
      byline: '',
      dir: '',
      siteName: '',
      lang: '',
      publishedTime: '',
    };
  }
}

/**
 * Get the clickable elements for the current page.
 * @param tabId - The ID of the tab to get the clickable elements for.
 * @param highlightElements - Whether to highlight the clickable elements.
 * @param focusElement - The element to focus on.
 * @param viewportExpansion - The viewport expansion to use. Larger values will include elements further from the visible viewport.
 *                          Setting to -1 will include all elements on the page.
 * @returns The clickable elements for the current page.
 */
export async function getClickableElements(
  tabId: number,
  highlightElements = true,
  focusElement = -1,
  viewportExpansion = 500,
): Promise<DOMState | null> {
  try {
    try {
      // First try with our custom DOM tree builder
      const elementTree = await _buildDomTree(tabId, highlightElements, focusElement, viewportExpansion);
      if (elementTree && 'children' in elementTree) {
        const selectorMap = createSelectorMap(elementTree as DOMElementNode);
        return {
          elementTree: elementTree as DOMElementNode,
          selectorMap,
        };
      }
    } catch (error) {
      console.error('Custom DOM tree building failed:', error);
      // Continue to fallback method if custom tree building fails
    }

    // FALLBACK: Use a native approach to get clickable elements
    console.log('Using fallback method to find clickable elements for sites that block script injection');

    // Use native DOM methods to extract interactive elements
    const interactiveElements = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          // Simple function to extract element data
          const extractElementInfo = (element: Element, index: number) => {
            const rect = element.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(element);
            const isVisible =
              rect.width > 0 &&
              rect.height > 0 &&
              computedStyle.display !== 'none' &&
              computedStyle.visibility !== 'hidden' &&
              computedStyle.opacity !== '0';

            if (!isVisible) return null;

            // Try to get a useful text representation of the element
            let text = '';
            if (element.hasAttribute('aria-label')) {
              text = element.getAttribute('aria-label') || '';
            } else if (element.hasAttribute('title')) {
              text = element.getAttribute('title') || '';
            } else if (element.hasAttribute('placeholder')) {
              text = element.getAttribute('placeholder') || '';
            } else if (element.hasAttribute('name')) {
              text = element.getAttribute('name') || '';
            } else {
              text = element.textContent?.trim() || '';
            }

            // Generate a simple XPath for the element
            const generateSimpleXPath = (el: Element): string => {
              if (!el || !el.parentElement) return '';

              const tagName = el.tagName.toLowerCase();

              if (el.id) {
                return `//${tagName}[@id="${el.id}"]`;
              }

              // Get the element's position among siblings of same type
              let count = 1;
              let sibling = el.previousElementSibling;
              while (sibling) {
                if (sibling.tagName === el.tagName) count++;
                sibling = sibling.previousElementSibling;
              }

              // Create a simple path segment
              return `${generateSimpleXPath(el.parentElement)}/${tagName}[${count}]`;
            };

            // Create a simplified element object
            return {
              tagName: element.tagName.toLowerCase(),
              text: text.substring(0, 100), // Limit text length
              xpath: generateSimpleXPath(element),
              attributes: {
                id: element.id || '',
                class: element.className || '',
                type: element.getAttribute('type') || '',
                href: element instanceof HTMLAnchorElement ? element.href : '',
                value: element instanceof HTMLInputElement ? element.value : '',
              },
              isInteractive: true,
              isVisible: true,
              isTopElement: true,
              highlightIndex: index,
              viewportCoordinates: {
                topLeft: { x: rect.left, y: rect.top },
                bottomRight: { x: rect.right, y: rect.bottom },
                center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
                width: rect.width,
                height: rect.height,
              },
            };
          };

          // Find all potentially interactive elements
          const interactiveSelectors = [
            'a',
            'button',
            'input',
            'select',
            'textarea',
            'label',
            '[role="button"]',
            '[role="link"]',
            '[role="checkbox"]',
            '[role="radio"]',
            '[role="tab"]',
            '[role="menuitem"]',
            '[role="combobox"]',
            '[role="option"]',
            '[onclick]',
            '[tabindex]:not([tabindex="-1"])',
            '[class*="btn"]',
            '[class*="button"]',
            '[class*="link"]',
            '[id*="btn"]',
            '[id*="button"]',
          ].join(',');

          const elements = Array.from(document.querySelectorAll(interactiveSelectors));

          // Process elements to extract relevant information
          const processedElements = elements.map((el, index) => extractElementInfo(el, index)).filter(Boolean); // Filter out null values

          return processedElements;
        } catch (e) {
          console.error('Error finding interactive elements:', e);
          return [];
        }
      },
    });

    const elementData = interactiveElements[0]?.result || [];

    if (elementData.length === 0) {
      console.warn('No interactive elements found with fallback method');
      return null;
    }

    // Create a synthetic DOM tree from the extracted elements
    const rootNode = new DOMElementNode({
      tagName: 'body',
      xpath: '/html/body',
      attributes: {},
      children: [],
      isVisible: true,
      isInteractive: false,
      isTopElement: true,
    });

    // Create a map for the elements
    const selectorMap = new Map<number, DOMElementNode>();

    // Add each interactive element as a child of the root
    elementData.forEach((data: any, index: number) => {
      if (!data) return;

      const elementNode = new DOMElementNode({
        tagName: data.tagName,
        xpath: data.xpath,
        attributes: data.attributes || {},
        children: [],
        isVisible: true,
        isInteractive: true,
        isTopElement: true,
        highlightIndex: index,
        viewportCoordinates: data.viewportCoordinates,
        parent: rootNode,
      });

      // Add text as a child if there's text content
      if (data.text) {
        const textNode = new DOMTextNode(data.text, true, elementNode);
        elementNode.children.push(textNode);
      }

      rootNode.children.push(elementNode);
      selectorMap.set(index, elementNode);
    });

    return {
      elementTree: rootNode,
      selectorMap,
    };
  } catch (error) {
    console.error('All methods to get clickable elements failed:', error);
    return null;
  }
}

function createSelectorMap(elementTree: DOMElementNode): Map<number, DOMElementNode> {
  const selectorMap = new Map<number, DOMElementNode>();

  function processNode(node: DOMBaseNode): void {
    if (node instanceof DOMElementNode) {
      if (node.highlightIndex != null) {
        // console.log('createSelectorMap node.highlightIndex:', node.highlightIndex);
        selectorMap.set(node.highlightIndex, node);
      }
      node.children.forEach(processNode);
    }
  }

  processNode(elementTree);
  return selectorMap;
}

async function _buildDomTree(
  tabId: number,
  highlightElements = true,
  focusElement = -1,
  viewportExpansion = 0,
): Promise<DOMElementNode> {
  try {
    // First check if the buildDomTree script is injected
    const scriptResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Object.prototype.hasOwnProperty.call(window, 'buildDomTree'),
    });

    // If script not found, inject it first
    if (!scriptResults[0]?.result) {
      console.log('BuildDomTree script not found, injecting it first...');
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['buildDomTree.js'],
      });
    }

    // Set a longer timeout for complex pages
    const results = (await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId },
        func: args => {
          try {
            // Access buildDomTree from the window context of the target page
            return window.buildDomTree(args);
          } catch (err) {
            console.error('Error in buildDomTree execution:', err);
            return null;
          }
        },
        args: [
          {
            doHighlightElements: highlightElements,
            focusHighlightIndex: focusElement,
            viewportExpansion,
          },
        ],
      }),
      // Timeout after 10 seconds
      new Promise((_, reject) => setTimeout(() => reject(new Error('DOM tree building timed out')), 10000)),
    ])) as chrome.scripting.InjectionResult[];

    const rawDomTree = results[0]?.result;
    if (rawDomTree !== null) {
      const elementTree = parseNode(rawDomTree as RawDomTreeNode);
      if (elementTree !== null && elementTree instanceof DOMElementNode) {
        return elementTree;
      }
    }

    throw new Error('Failed to build DOM tree: Invalid or empty tree structure');
  } catch (error) {
    console.error('Error building DOM tree:', error);

    // Attempt fallback with simplified settings
    try {
      console.log('Attempting fallback DOM tree building with simplified settings...');
      const fallbackResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          try {
            // Use simplified settings with expanded viewport and no highlighting
            return window.buildDomTree({
              doHighlightElements: false,
              focusHighlightIndex: -1,
              viewportExpansion: -1, // Include all elements
            });
          } catch (err) {
            console.error('Error in fallback buildDomTree execution:', err);
            return null;
          }
        },
      });

      const fallbackRawDomTree = fallbackResults[0]?.result;
      if (fallbackRawDomTree !== null) {
        const fallbackElementTree = parseNode(fallbackRawDomTree as RawDomTreeNode);
        if (fallbackElementTree !== null && fallbackElementTree instanceof DOMElementNode) {
          return fallbackElementTree;
        }
      }
    } catch (fallbackError) {
      console.error('Fallback DOM tree building failed:', fallbackError);
    }

    // Create a minimal DOM element as last resort
    const minimalDomTree = new DOMElementNode({
      tagName: 'body',
      xpath: '/html/body',
      attributes: {},
      children: [],
      isVisible: true,
      isInteractive: false,
      isTopElement: true,
    });

    return minimalDomTree;
  }
}

function parseNode(nodeData: RawDomTreeNode, parent: DOMElementNode | null = null): DOMBaseNode | null {
  if (!nodeData) return null;

  if ('type' in nodeData) {
    // && nodeData.type === 'TEXT_NODE'
    return new DOMTextNode(nodeData.text, nodeData.isVisible, parent);
  }

  const tagName = nodeData.tagName;

  // Parse coordinates if they exist
  const viewportCoordinates = nodeData.viewportCoordinates;
  const pageCoordinates = nodeData.pageCoordinates;
  const viewportInfo = nodeData.viewportInfo;

  // Element node (possible other kinds of nodes, but we don't care about them for now)
  const elementNode = new DOMElementNode({
    tagName: tagName,
    xpath: nodeData.xpath,
    attributes: nodeData.attributes ?? {},
    children: [],
    isVisible: nodeData.isVisible ?? false,
    isInteractive: nodeData.isInteractive ?? false,
    isTopElement: nodeData.isTopElement ?? false,
    highlightIndex: nodeData.highlightIndex,
    viewportCoordinates: viewportCoordinates ?? undefined,
    pageCoordinates: pageCoordinates ?? undefined,
    viewportInfo: viewportInfo ?? undefined,
    shadowRoot: nodeData.shadowRoot ?? false,
    parent,
  });

  const children: DOMBaseNode[] = [];
  for (const child of nodeData.children || []) {
    if (child !== null) {
      const childNode = parseNode(child, elementNode);
      if (childNode !== null) {
        children.push(childNode);
      }
    }
  }

  elementNode.children = children;
  return elementNode;
}

export async function removeHighlights(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Remove the highlight container and all its contents
        const container = document.getElementById('playwright-highlight-container');
        if (container) {
          container.remove();
        }

        // Remove highlight attributes from elements
        const highlightedElements = document.querySelectorAll('[browser-user-highlight-id^="playwright-highlight-"]');
        for (const el of Array.from(highlightedElements)) {
          el.removeAttribute('browser-user-highlight-id');
        }
      },
    });
  } catch (error) {
    logger.error('Failed to remove highlights:', error);
  }
}
