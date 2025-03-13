window.buildDomTree = (args = { doHighlightElements: true, focusHighlightIndex: -1, viewportExpansion: 0 }) => {
  const { doHighlightElements, focusHighlightIndex, viewportExpansion } = args;
  let highlightIndex = 0; // Reset highlight index

  // Quick check to confirm the script receives focusHighlightIndex
  console.log('focusHighlightIndex:', focusHighlightIndex);

  function highlightElement(element, index, parentIframe = null) {
    // Create or get highlight container
    let container = document.getElementById('playwright-highlight-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'playwright-highlight-container';
      container.style.position = 'absolute';
      container.style.pointerEvents = 'none';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.zIndex = '2147483647'; // Maximum z-index value
      document.body.appendChild(container);
    }

    // Generate a color based on the index
    const colors = [
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#FFA500',
      '#800080',
      '#008080',
      '#FF69B4',
      '#4B0082',
      '#FF4500',
      '#2E8B57',
      '#DC143C',
      '#4682B4',
    ];
    const colorIndex = index % colors.length;
    const baseColor = colors[colorIndex];
    const backgroundColor = `${baseColor}1A`; // 10% opacity version of the color

    // Create highlight overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.border = `2px solid ${baseColor}`;
    overlay.style.backgroundColor = backgroundColor;
    overlay.style.pointerEvents = 'none';
    overlay.style.boxSizing = 'border-box';

    // Position overlay based on element, including scroll position
    const rect = element.getBoundingClientRect();
    let top = rect.top + window.scrollY;
    let left = rect.left + window.scrollX;

    // Adjust position if element is inside an iframe
    if (parentIframe) {
      const iframeRect = parentIframe.getBoundingClientRect();
      top += iframeRect.top;
      left += iframeRect.left;
    }

    overlay.style.top = `${top}px`;
    overlay.style.left = `${left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    // Create label
    const label = document.createElement('div');
    label.className = 'playwright-highlight-label';
    label.style.position = 'absolute';
    label.style.background = baseColor;
    label.style.color = 'white';
    label.style.padding = '1px 4px';
    label.style.borderRadius = '4px';
    label.style.fontSize = `${Math.min(12, Math.max(8, rect.height / 2))}px`; // Responsive font size
    label.textContent = index;

    // Calculate label position
    const labelWidth = 20; // Approximate width
    const labelHeight = 16; // Approximate height

    // Default position (top-right corner inside the box)
    let labelTop = top + 2;
    let labelLeft = left + rect.width - labelWidth - 2;

    // Adjust if box is too small
    if (rect.width < labelWidth + 4 || rect.height < labelHeight + 4) {
      // Position outside the box if it's too small
      labelTop = top - labelHeight - 2;
      labelLeft = left + rect.width - labelWidth;
    }

    label.style.top = `${labelTop}px`;
    label.style.left = `${labelLeft}px`;

    // Add to container
    container.appendChild(overlay);
    container.appendChild(label);

    // Store reference for cleanup
    element.setAttribute('browser-user-highlight-id', `playwright-highlight-${index}`);

    return index + 1;
  }

  // Helper function to generate CSS selector for an element
  function generateCssSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    // Use ID if available - most reliable
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    // Special case for document body
    if (element.tagName.toLowerCase() === 'body') {
      return 'body';
    }

    // Get element's position among siblings with same tag
    const getElementPosition = el => {
      let position = 1;
      let sibling = el.previousElementSibling;

      while (sibling) {
        if (sibling.tagName === el.tagName) {
          position++;
        }
        sibling = sibling.previousElementSibling;
      }

      return position === 1 ? null : position;
    };

    // Build selector recursively
    let selector = '';
    let currentElement = element;

    while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
      // Stop at document body or if we reach shadow root boundary
      if (
        currentElement.tagName.toLowerCase() === 'body' ||
        currentElement.parentElement === null ||
        currentElement.getRootNode() !== document
      ) {
        selector = 'body ' + selector;
        break;
      }

      // Start building this level's selector
      let levelSelector = currentElement.tagName.toLowerCase();

      // Add classes (up to 2 stable-looking ones)
      const classes = Array.from(currentElement.classList)
        .filter(c => !c.startsWith('js-') && !/^[a-z][a-z0-9](_[a-z0-9]+)+$/i.test(c))
        .slice(0, 2);

      if (classes.length > 0) {
        levelSelector += classes.map(c => `.${CSS.escape(c)}`).join('');
      }

      // Add position if needed
      const position = getElementPosition(currentElement);
      if (position) {
        levelSelector += `:nth-of-type(${position})`;
      }

      // Add to overall selector
      selector = levelSelector + (selector ? ' > ' + selector : '');

      // Continue with parent
      currentElement = currentElement.parentElement;
    }

    return selector;
  }

  // Helper function to generate XPath as a tree
  function getXPathTree(element, stopAtBoundary = true) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const segments = [];
    let currentElement = element;

    try {
      while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
        // Stop if we hit a shadow root or iframe
        if (
          stopAtBoundary &&
          (currentElement.parentNode instanceof ShadowRoot ||
            currentElement.parentNode instanceof HTMLIFrameElement ||
            !currentElement.parentElement)
        ) {
          break;
        }

        let index = 0;
        let sibling = currentElement.previousSibling;
        while (sibling) {
          if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === currentElement.nodeName) {
            index++;
          }
          sibling = sibling.previousSibling;
        }

        const tagName = currentElement.nodeName.toLowerCase();
        const xpathIndex = index > 0 ? `[${index + 1}]` : '';

        // Include helpful attributes like id and class in the XPath for easier debugging
        let attributeString = '';
        if (currentElement.id) {
          attributeString += `[@id="${currentElement.id}"]`;
        } else if (currentElement.className && typeof currentElement.className === 'string') {
          // Only include short class names to keep xpath manageable
          const classList = currentElement.className.split(/\s+/).filter(c => c.length < 20);
          if (classList.length > 0) {
            attributeString += `[@class="${classList[0]}"]`;
          }
        }

        segments.unshift(`${tagName}${xpathIndex}${attributeString}`);

        // Move up to parent node
        currentElement = currentElement.parentElement;
      }

      return segments.join('/');
    } catch (e) {
      console.error('Error generating XPath:', e);
      // Fallback to a simpler XPath in case of errors
      return `//${element.tagName.toLowerCase()}`;
    }
  }

  // Helper function to check if element is accepted
  function isElementAccepted(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const leafElementDenyList = new Set([
      'svg',
      'script',
      'style',
      'link',
      'meta',
      'noscript',
      'path',
      'circle',
      'polygon',
      'ellipse',
      'rect',
      'polyline',
      'defs',
    ]);

    const tagName = element.tagName.toLowerCase();

    // Basic deny list check
    if (leafElementDenyList.has(tagName)) {
      return false;
    }

    // Skip invisible elements with no children
    if (element.children.length === 0) {
      const hasText = element.textContent.trim().length > 0;
      if (!hasText) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return false;
        }
      }
    }

    return true;
  }

  // Helper function to check if element is interactive
  function isInteractiveElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    // Immediately return false for body tag and other container elements
    const nonInteractiveTags = new Set(['body', 'html', 'main', 'article', 'section', 'div', 'span', 'p']);
    const tagName = element.tagName.toLowerCase();

    if (nonInteractiveTags.has(tagName) && !hasInteractiveAttributes(element)) {
      return false;
    }

    // Base interactive elements and roles
    const interactiveElements = new Set([
      'a',
      'button',
      'details',
      'embed',
      'input',
      'label',
      'select',
      'textarea',
      'option',
      'menuitem',
      'summary',
      'form',
      'audio',
      'video',
      'iframe',
    ]);

    const interactiveRoles = new Set([
      'button',
      'menu',
      'menuitem',
      'link',
      'checkbox',
      'radio',
      'slider',
      'tab',
      'tabpanel',
      'textbox',
      'combobox',
      'grid',
      'listbox',
      'option',
      'progressbar',
      'scrollbar',
      'searchbox',
      'switch',
      'tree',
      'treeitem',
      'spinbutton',
      'tooltip',
      'a-button-inner',
      'a-dropdown-button',
      'click',
      'menuitemcheckbox',
      'menuitemradio',
      'a-button-text',
      'button-text',
      'button-icon',
      'button-icon-only',
      'button-text-icon-only',
      'dropdown',
      'combobox',
    ]);

    function hasInteractiveAttributes(el) {
      const role = el.getAttribute('role');
      const ariaRole = el.getAttribute('aria-role');
      const tabIndex = el.getAttribute('tabindex');

      // Check common interactive attributes
      if (interactiveRoles.has(role) || interactiveRoles.has(ariaRole)) {
        return true;
      }

      // Check for ARIA attributes that suggest interactivity
      if (
        el.hasAttribute('aria-expanded') ||
        el.hasAttribute('aria-pressed') ||
        el.hasAttribute('aria-selected') ||
        el.hasAttribute('aria-checked')
      ) {
        return true;
      }

      // Check for action attributes (common in frameworks)
      const actionAttrs = ['onclick', 'ng-click', '@click', 'v-on:click', 'data-action'];
      for (const attr of actionAttrs) {
        if (el.hasAttribute(attr)) {
          return true;
        }
      }

      // Check tabindex for focusable elements
      if (tabIndex !== null && tabIndex !== '-1') {
        return true;
      }

      // Check cursor style
      const style = window.getComputedStyle(el);
      if (style.cursor === 'pointer') {
        return true;
      }

      return false;
    }

    // Check for basic interactive elements
    if (interactiveElements.has(tagName)) {
      return true;
    }

    // Common attributes for clickable elements
    const interactiveClass = element.className.toString().toLowerCase();
    if (
      interactiveClass.includes('button') ||
      interactiveClass.includes('clickable') ||
      interactiveClass.includes('selectable') ||
      interactiveClass.includes('link') ||
      interactiveClass.includes('toggle')
    ) {
      return true;
    }

    // Common interactive ids
    const id = element.id.toLowerCase();
    if (
      id.includes('button') ||
      id.includes('clickable') ||
      id.includes('link') ||
      id.includes('toggle') ||
      id.includes('dropdown')
    ) {
      return true;
    }

    // Check for event listeners
    const hasClickHandler =
      element.onclick !== null ||
      element.getAttribute('onclick') !== null ||
      element.hasAttribute('ng-click') ||
      element.hasAttribute('@click') ||
      element.hasAttribute('v-on:click');

    if (hasClickHandler) {
      return true;
    }

    // Helper function to safely get event listeners
    function getEventListeners(el) {
      try {
        // Try to get listeners using Chrome DevTools API
        return window.getEventListeners?.(el) || {};
      } catch (e) {
        // Fallback: check for common event properties
        const listeners = {};

        // List of common event types to check
        const eventTypes = [
          'click',
          'mousedown',
          'mouseup',
          'touchstart',
          'touchend',
          'keydown',
          'keyup',
          'focus',
          'blur',
        ];

        for (const type of eventTypes) {
          const handler = el[`on${type}`];
          if (handler) {
            listeners[type] = [
              {
                listener: handler,
                useCapture: false,
              },
            ];
          }
        }

        return listeners;
      }
    }

    // Check for click-related events on the element itself
    const listeners = getEventListeners(element);
    const hasClickListeners =
      listeners &&
      (listeners.click?.length > 0 ||
        listeners.mousedown?.length > 0 ||
        listeners.mouseup?.length > 0 ||
        listeners.touchstart?.length > 0 ||
        listeners.touchend?.length > 0);

    if (hasClickListeners) {
      return true;
    }

    // Additional check for cursor style
    const style = window.getComputedStyle(element);
    if (style.cursor === 'pointer') {
      return true;
    }

    return hasInteractiveAttributes(element);
  }

  // Helper function to check if element is visible, with tolerance for partially visible elements
  function isElementVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    try {
      // Get computed style
      const style = window.getComputedStyle(element);

      // Basic visibility check
      if (
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        style.opacity === '0' ||
        style.visibility === 'collapse'
      ) {
        return false;
      }

      // Check element dimensions
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return false;
      }

      // Check if element is within reasonable bounds of the viewport or document
      // (include elements slightly outside viewport)
      const docEl = document.documentElement;
      const viewportWidth = window.innerWidth || docEl.clientWidth;
      const viewportHeight = window.innerHeight || docEl.clientHeight;

      // Consider elements visible if they're within 100px of the viewport
      const buffer = 100;
      if (
        rect.right < -buffer ||
        rect.bottom < -buffer ||
        rect.left > viewportWidth + buffer ||
        rect.top > viewportHeight + buffer
      ) {
        return false;
      }

      // Check if parent elements hide this element
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const parentStyle = window.getComputedStyle(parent);
        if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden' || parentStyle.opacity === '0') {
          return false;
        }
        parent = parent.parentElement;
      }

      return true;
    } catch (e) {
      console.error('Error checking element visibility:', e);
      // Default to true in case of errors - better to include than exclude
      return true;
    }
  }

  // Helper function to check if element is the top element at its position
  function isTopElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    // Find the correct document context and root element
    let doc = element.ownerDocument;

    // If we're in an iframe, elements are considered top by default
    if (doc !== window.document) {
      return true;
    }

    // For shadow DOM, we need to check within its own root context
    const rootNode = element.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      const rect = element.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

      try {
        // Use shadow root's elementFromPoint to check within shadow DOM context
        const topEl = rootNode.elementFromPoint(point.x, point.y);
        if (!topEl) return false;

        // Check if the element or any of its parents match our target element
        let current = topEl;
        while (current && current !== rootNode) {
          if (current === element) return true;
          current = current.parentElement;
        }
        return false;
      } catch (e) {
        console.error('Error in shadow DOM elementFromPoint:', e);
        return true; // If we can't determine, consider it visible
      }
    }

    // Regular DOM elements
    const rect = element.getBoundingClientRect();

    // If viewportExpansion is -1, consider all elements as top elements
    if (viewportExpansion === -1) {
      return true;
    }

    // Calculate expanded viewport boundaries including scroll position
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const viewportTop = -viewportExpansion + scrollY;
    const viewportLeft = -viewportExpansion + scrollX;
    const viewportBottom = window.innerHeight + viewportExpansion + scrollY;
    const viewportRight = window.innerWidth + viewportExpansion + scrollX;

    // Get absolute element position
    const absTop = rect.top + scrollY;
    const absLeft = rect.left + scrollX;
    const absBottom = rect.bottom + scrollY;
    const absRight = rect.right + scrollX;

    // Skip if element is completely outside expanded viewport
    if (absBottom < viewportTop || absTop > viewportBottom || absRight < viewportLeft || absLeft > viewportRight) {
      return false;
    }

    // For elements within expanded viewport, check if they're the top element
    try {
      // Check multiple points within the element for more accurate detection
      const checkPoints = [
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, // center
        { x: rect.left + 5, y: rect.top + 5 }, // top-left
        { x: rect.right - 5, y: rect.top + 5 }, // top-right
        { x: rect.left + 5, y: rect.bottom - 5 }, // bottom-left
        { x: rect.right - 5, y: rect.bottom - 5 }, // bottom-right
      ];

      // Check each point, return true if any point is at the top
      for (const point of checkPoints) {
        // Skip points outside viewport
        if (point.x < 0 || point.x >= window.innerWidth || point.y < 0 || point.y >= window.innerHeight) {
          continue;
        }

        const topEl = document.elementFromPoint(point.x, point.y);
        if (!topEl) continue;

        // Check if the top element is our target or one of its children
        let current = topEl;
        while (current && current !== document.documentElement) {
          if (current === element) {
            return true;
          }
          current = current.parentElement;
        }
      }

      return false;
    } catch (e) {
      console.error('Error in elementFromPoint:', e);
      return true; // If we can't determine, consider it visible for safety
    }
  }

  // Helper function to check if text node is visible
  function isTextNodeVisible(textNode) {
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      return false;
    }

    try {
      // Skip empty text
      const text = textNode.textContent.trim();
      if (!text) {
        return false;
      }

      // Check parent element visibility
      const parent = textNode.parentElement;
      if (!parent || !isElementVisible(parent)) {
        return false;
      }

      // Check text node dimensions
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();

      // Text with zero dimensions is not visible
      if (rect.width === 0 && rect.height === 0) {
        return false;
      }

      // Text should be at least partially within viewport
      const isInViewport =
        rect.top <= window.innerHeight && rect.left <= window.innerWidth && rect.bottom >= 0 && rect.right >= 0;

      return isInViewport;
    } catch (e) {
      console.error('Error checking text node visibility:', e);
      // Default to false for text nodes on error
      return false;
    }
  }

  // Function to traverse the DOM and create nested JSON
  function buildDomTree(node, parentIframe = null) {
    if (!node) return null;

    // Special case for text nodes
    if (node.nodeType === Node.TEXT_NODE) {
      const textContent = node.textContent.trim();
      if (textContent && isTextNodeVisible(node)) {
        return {
          type: 'TEXT_NODE',
          text: textContent,
          isVisible: true,
        };
      }
      return null;
    }

    // Check if element is accepted
    if (node.nodeType === Node.ELEMENT_NODE && !isElementAccepted(node)) {
      return null;
    }

    // Create basic node data
    const nodeData = {
      tagName: node.tagName ? node.tagName.toLowerCase() : null,
      attributes: {},
      // Generate multiple selector types for robustness
      xpath: node.nodeType === Node.ELEMENT_NODE ? getXPathTree(node, true) : null,
      cssSelector: node.nodeType === Node.ELEMENT_NODE ? generateCssSelector(node) : null,
      children: [],
    };

    // Add coordinates for element nodes
    if (node.nodeType === Node.ELEMENT_NODE) {
      const rect = node.getBoundingClientRect();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;

      // Viewport-relative coordinates (can be negative when scrolled)
      nodeData.viewportCoordinates = {
        topLeft: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
        },
        topRight: {
          x: Math.round(rect.right),
          y: Math.round(rect.top),
        },
        bottomLeft: {
          x: Math.round(rect.left),
          y: Math.round(rect.bottom),
        },
        bottomRight: {
          x: Math.round(rect.right),
          y: Math.round(rect.bottom),
        },
        center: {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        },
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      // Page-relative coordinates (always positive, relative to page origin)
      nodeData.pageCoordinates = {
        topLeft: {
          x: Math.round(rect.left + scrollX),
          y: Math.round(rect.top + scrollY),
        },
        topRight: {
          x: Math.round(rect.right + scrollX),
          y: Math.round(rect.top + scrollY),
        },
        bottomLeft: {
          x: Math.round(rect.left + scrollX),
          y: Math.round(rect.bottom + scrollY),
        },
        bottomRight: {
          x: Math.round(rect.right + scrollX),
          y: Math.round(rect.bottom + scrollY),
        },
        center: {
          x: Math.round(rect.left + rect.width / 2 + scrollX),
          y: Math.round(rect.top + rect.height / 2 + scrollY),
        },
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      // Add viewport and scroll information
      nodeData.viewport = {
        scrollX: Math.round(scrollX),
        scrollY: Math.round(scrollY),
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }

    // Copy all attributes if the node is an element
    if (node.nodeType === Node.ELEMENT_NODE && node.attributes) {
      try {
        // Use getAttributeNames() instead of directly iterating attributes
        const attributeNames = node.getAttributeNames?.() || [];
        for (const name of attributeNames) {
          try {
            nodeData.attributes[name] = node.getAttribute(name);
          } catch (e) {
            // Handle any errors in attribute retrieval
            console.error(`Error retrieving attribute '${name}':`, e);
            nodeData.attributes[name] = '[error retrieving attribute]';
          }
        }
      } catch (e) {
        console.error('Error processing element attributes:', e);
      }
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      try {
        const isInteractive = isInteractiveElement(node);
        const isVisible = isElementVisible(node);
        const isTop = isTopElement(node);

        nodeData.isInteractive = isInteractive;
        nodeData.isVisible = isVisible;
        nodeData.isTopElement = isTop;

        // Highlight if element meets all criteria and highlighting is enabled
        if (isInteractive && isVisible && isTop) {
          nodeData.highlightIndex = highlightIndex++;
          if (doHighlightElements) {
            if (focusHighlightIndex >= 0) {
              if (focusHighlightIndex === nodeData.highlightIndex) {
                highlightElement(node, nodeData.highlightIndex, parentIframe);
              }
            } else {
              highlightElement(node, nodeData.highlightIndex, parentIframe);
            }
          }
        }
      } catch (e) {
        console.error('Error processing interactive/visible status:', e);
        // Default values
        nodeData.isInteractive = false;
        nodeData.isVisible = true;
        nodeData.isTopElement = false;
      }
    }

    // Only add shadowRoot field if it exists
    if (node.shadowRoot) {
      nodeData.shadowRoot = true;
    }

    try {
      // Handle shadow DOM with better error recovery
      if (node.shadowRoot) {
        try {
          const shadowChildren = Array.from(node.shadowRoot.childNodes)
            .map(child => buildDomTree(child, parentIframe))
            .filter(Boolean); // Filter out null entries

          nodeData.children.push(...shadowChildren);
        } catch (e) {
          console.error('Error processing shadow DOM:', e);
        }
      }

      // Handle iframes with better error isolation
      if (node.tagName === 'IFRAME') {
        try {
          // Attempt to access iframe content
          const iframeDoc = node.contentDocument || (node.contentWindow && node.contentWindow.document);
          if (iframeDoc && iframeDoc.body) {
            try {
              const iframeChildren = Array.from(iframeDoc.body.childNodes)
                .map(child => buildDomTree(child, node))
                .filter(Boolean); // Filter out null entries

              nodeData.children.push(...iframeChildren);
            } catch (iframeError) {
              console.warn('Error processing iframe children:', iframeError);
            }
          }
        } catch (accessError) {
          // Cross-origin iframes will be blocked - this is normal
          console.info('Unable to access iframe content (possibly cross-origin):', accessError);
          nodeData.isCrossOrigin = true;
        }
      } else {
        // Process regular children
        const children = Array.from(node.childNodes)
          .map(child => buildDomTree(child, parentIframe))
          .filter(Boolean); // Filter out null entries

        nodeData.children.push(...children);
      }
    } catch (childProcessingError) {
      console.error('Error processing node children:', childProcessingError);
    }

    return nodeData;
  }

  try {
    // First try to process the entire document
    return buildDomTree(document.body);
  } catch (e) {
    console.error('Error building DOM tree, falling back to document body children:', e);

    // If the full tree fails, try a more conservative approach
    try {
      const rootNode = {
        tagName: 'body',
        attributes: {},
        xpath: '/body',
        cssSelector: 'body',
        children: [],
        isVisible: true,
        isInteractive: false,
        isTopElement: true,
      };

      // Process each direct child of the body separately to isolate failures
      Array.from(document.body.children).forEach((child, index) => {
        try {
          const childData = buildDomTree(child);
          if (childData) {
            rootNode.children.push(childData);
          }
        } catch (childError) {
          console.error(`Error processing body child ${index}:`, childError);
        }
      });

      return rootNode;
    } catch (fallbackError) {
      console.error('All DOM tree building methods failed:', fallbackError);

      // Ultimate fallback - just return basic page structure
      return {
        tagName: 'body',
        attributes: {},
        xpath: '/body',
        cssSelector: 'body',
        children: [],
        isVisible: true,
        isInteractive: false,
        isTopElement: true,
        error: 'DOM tree building failed - page too complex or restricted',
      };
    }
  }
};
