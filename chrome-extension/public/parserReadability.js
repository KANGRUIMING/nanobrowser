/**
 * Enhanced Readability Parser
 * This implementation provides more robust content extraction capabilities
 * that work across a wide variety of websites, including complex single-page applications
 */

window.parserReadability = function () {
  // Use Mozilla's Readability implementation if it exists
  if (typeof Readability !== 'undefined') {
    try {
      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();

      if (article && article.content) {
        return {
          title: article.title || document.title,
          content: article.content,
          textContent: article.textContent,
          length: article.textContent ? article.textContent.length : 0,
          excerpt: article.excerpt || getMetaDescription(),
          byline: article.byline || '',
          dir: article.dir || document.dir || 'ltr',
          siteName: article.siteName || getMetaSiteName(),
          lang: article.lang || document.documentElement.lang || 'en',
          publishedTime: getMetaPublishedTime(),
        };
      }
    } catch (e) {
      console.error('Original readability parse failed, falling back to custom parser', e);
      // Fall through to custom implementation
    }
  }

  // Custom implementation that's more robust for complex sites
  return customReadabilityParser();

  // Helper functions
  function getMetaDescription() {
    const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function getMetaSiteName() {
    const meta = document.querySelector('meta[property="og:site_name"]');
    const siteName = meta ? meta.getAttribute('content') : '';

    if (siteName) return siteName;

    // Fallback to domain name
    const hostname = window.location.hostname;
    return hostname.replace(/^www\./, '');
  }

  function getMetaPublishedTime() {
    const meta = document.querySelector(
      'meta[property="article:published_time"], meta[name="publication_date"], meta[name="date"]',
    );
    return meta ? meta.getAttribute('content') : '';
  }

  function customReadabilityParser() {
    // Get document title
    let title = document.title;

    // Try to get a better title if possible
    const potentialTitles = [
      ...Array.from(document.querySelectorAll('h1')),
      ...Array.from(document.querySelectorAll('[class*="title" i]:not(meta):not(script):not(style)')),
      ...Array.from(document.querySelectorAll('[id*="title" i]:not(meta):not(script):not(style)')),
    ];

    // Find the most prominent title element
    let bestTitle = '';
    let bestTitleScore = 0;

    potentialTitles.forEach(element => {
      const text = element.textContent.trim();
      if (text.length > 5 && text.length < 200) {
        const rect = element.getBoundingClientRect();
        // Score based on visibility, size, and position
        const isVisible =
          rect.width > 0 &&
          rect.height > 0 &&
          window.getComputedStyle(element).display !== 'none' &&
          window.getComputedStyle(element).visibility !== 'hidden';

        if (isVisible) {
          const fontSize = parseInt(window.getComputedStyle(element).fontSize);
          const position = rect.top;

          // Higher score for larger font and position closer to top
          const score = (fontSize * (1000 - (position > 0 ? position : 0))) / 1000;

          if (score > bestTitleScore) {
            bestTitleScore = score;
            bestTitle = text;
          }
        }
      }
    });

    if (bestTitle) {
      title = bestTitle;
    }

    // Extract main content while avoiding boilerplate elements
    const contentElements = findMainContentElements();
    let content = '';
    let textContent = '';

    contentElements.forEach(element => {
      // Extract HTML
      content += element.outerHTML;

      // Extract text content
      const elementText = extractTextFromElement(element);
      if (elementText.trim()) {
        textContent += elementText + '\n\n';
      }
    });

    // If we couldn't find content, try a more aggressive approach
    if (!content) {
      content = document.body.innerHTML;
      textContent = document.body.textContent;
    }

    // Clean up content
    textContent = textContent.replace(/[\t\r\n]+/g, '\n').trim();

    // Create excerpt (first ~200 characters)
    const excerpt = textContent.substring(0, 200).trim() + (textContent.length > 200 ? '...' : '');

    return {
      title: title,
      content: content,
      textContent: textContent,
      length: textContent.length,
      excerpt: excerpt,
      byline: findAuthorInfo(),
      dir: document.dir || 'ltr',
      siteName: getMetaSiteName(),
      lang: document.documentElement.lang || 'en',
      publishedTime: getMetaPublishedTime(),
    };
  }

  function findMainContentElements() {
    // Start with known content containers
    const potentialContainers = [
      ...Array.from(document.querySelectorAll('article, [role="article"], main, [role="main"]')),
      ...Array.from(document.querySelectorAll('[class*="content" i]:not(meta):not(script):not(style)')),
      ...Array.from(document.querySelectorAll('[id*="content" i]:not(meta):not(script):not(style)')),
      ...Array.from(document.querySelectorAll('[class*="article" i]:not(meta):not(script):not(style)')),
      ...Array.from(document.querySelectorAll('[id*="article" i]:not(meta):not(script):not(style)')),
    ];

    // Filter out elements likely to be part of navigation, sidebars, or footers
    const contentElements = potentialContainers.filter(element => {
      // Skip very small elements
      if (element.textContent.trim().length < 200) return false;

      // Skip navigation, footer, etc.
      const tagName = element.tagName.toLowerCase();
      const className = element.className.toLowerCase();
      const id = element.id.toLowerCase();

      const isBoilerplate =
        tagName === 'nav' ||
        element.matches('nav, header, footer, aside') ||
        element.getAttribute('role') === 'navigation' ||
        className.includes('nav') ||
        className.includes('menu') ||
        className.includes('header') ||
        className.includes('footer') ||
        className.includes('sidebar') ||
        id.includes('nav') ||
        id.includes('menu') ||
        id.includes('header') ||
        id.includes('footer') ||
        id.includes('sidebar');

      return !isBoilerplate;
    });

    // If we found content elements, use them
    if (contentElements.length > 0) {
      return contentElements;
    }

    // Fallback: try to find the element with the most text
    const paragraphs = document.querySelectorAll('p');
    const paragraphParents = new Map();

    paragraphs.forEach(p => {
      if (p.textContent.trim().length < 20) return; // Skip very short paragraphs

      // Find the closest relevant parent
      let parent = p.parentElement;
      while (parent && parent !== document.body) {
        // Skip container elements that are too general
        if (parent.tagName.toLowerCase() === 'div' && !parent.id && !parent.className) {
          parent = parent.parentElement;
          continue;
        }

        const count = paragraphParents.get(parent) || 0;
        paragraphParents.set(parent, count + 1);
        break;
      }
    });

    // Convert to array and sort by paragraph count
    const sortedParents = Array.from(paragraphParents.entries()).sort((a, b) => b[1] - a[1]);

    // Return the top containers or the body as last resort
    return sortedParents.length > 0 ? sortedParents.slice(0, 3).map(entry => entry[0]) : [document.body];
  }

  function extractTextFromElement(element) {
    // Get all text nodes, excluding script, style, etc.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        // Skip script, style, and hidden text
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tagName = parent.tagName.toLowerCase();
        if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
          return NodeFilter.FILTER_REJECT;
        }

        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let text = '';
    let node;
    while ((node = walker.nextNode())) {
      text += node.textContent.trim() + ' ';
    }

    return text.trim();
  }

  function findAuthorInfo() {
    // Check for author meta tags
    const authorMeta = document.querySelector('meta[name="author"], meta[property="article:author"]');
    if (authorMeta) {
      const authorContent = authorMeta.getAttribute('content');
      if (authorContent) return authorContent;
    }

    // Look for common author patterns in the DOM
    const authorSelectors = [
      '[class*="author" i]:not(meta)',
      '[id*="author" i]:not(meta)',
      '[class*="byline" i]',
      '[rel="author"]',
      '[itemprop="author"]',
    ];

    for (const selector of authorSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent.trim();
        if (text && text.length < 100) {
          // Author names shouldn't be too long
          return text;
        }
      }
    }

    return '';
  }
};

// Ensure the parser is available immediately when the page loads
document.addEventListener('DOMContentLoaded', function () {
  console.log('Readability parser initialized');
  // Make the function immediately accessible
  if (!window.parserReadability) {
    console.error('Failed to initialize readability parser!');
  }
});
