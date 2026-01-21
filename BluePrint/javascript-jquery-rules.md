---
description: JavaScript and jQuery coding standards and patterns
globs: 
alwaysApply: true
---
# JavaScript & jQuery Rules

## jQuery Selector Rules
- Always cache jQuery selectors in variables: `const $userList = $('.user-list');`
- Prefix jQuery variables with `$`: `$button`, `$container`, `$list`
- Use ID selectors when possible for performance: `$('#main-container')` over `$('.main-container')`
- Scope selectors to a context: `$container.find('.item')` or `$('.item', '#product-list')`
- Never query the same selector multiple times - cache it once, reuse

## jQuery Chaining
- Chain methods for cleaner code instead of repeating selectors
- Use `.end()` to return to previous selector in chain
- Pattern: `$('#menu').addClass('active').find('li').show().end().css('opacity', 1);`

## Event Handling Patterns
- Use event delegation for dynamic elements: `$('#list').on('click', '.item', handler)`
- Namespace events for easy cleanup: `$('#element').on('click.myFeature', handler)`
- Remove namespaced events: `$('#element').off('.myFeature')`
- Use `e.preventDefault()` explicitly, avoid `return false`
- Initialize with short form: `$(function() { /* init */ });`

## Object Literal Pattern
- Pattern: `var {module}Grid = { init: function(), initHandlers: function(), ... }`
- Always include `init` method for initialization
- Include `destroy` method for cleanup when removing elements
- Bind event context with `.bind(this)` or store `const self = this;`

Example:
```javascript
var UserManager = {
  users: [],
  
  init: function(config) {
    this.maxUsers = config.maxUsers || 100;
    this.bindEvents();
    return this;
  },
  
  bindEvents: function() {
    $('#add-user').on('click', this.handleAddUser.bind(this));
  },
  
  handleAddUser: function(e) {
    e.preventDefault();
    const name = $('#user-name').val();
    this.addUser(name);
  },
  
  addUser: function(name) {
    this.users.push({ name: name, id: Date.now() });
    this.render();
  },
  
  render: function() {
    const $list = $('#user-list').empty();
    this.users.forEach(function(user) {
      $list.append('<li data-id="' + user.id + '">' + user.name + '</li>');
    });
  }
};

// Initialize
UserManager.init({ maxUsers: 50 });
```

## Module Pattern with IIFE
- Use for private/public separation: `var Module = (function() { /* private */ return { /* public */ }; })();`
- Private variables and functions inside closure
- Return object exposes public API only
- Return copies of data, not references: `return items.slice();`

Example:
```javascript
var ShoppingCart = (function() {
  // Private
  let items = [];
  let taxRate = 0.08;
  
  function calculateTax(amount) {
    return amount * taxRate;
  }
  
  // Public API
  return {
    addItem: function(item) {
      items.push(item);
      this.updateDisplay();
    },
    
    getItems: function() {
      return items.slice(); // Return copy
    },
    
    getTotal: function() {
      const subtotal = items.reduce(function(sum, item) {
        return sum + item.price;
      }, 0);
      return subtotal + calculateTax(subtotal);
    },
    
    init: function() {
      const self = this;
      $('#cart').on('click', '.remove-item', function() {
        self.removeItem($(this).data('item-id'));
      });
      return this;
    }
  };
})();
```

## Constructor Pattern
- Use for multiple instances: `function Carousel($element, options) { this.init(); }`
- Define defaults as static property: `Carousel.defaults = { autoplay: true };`
- Merge options with defaults: `this.options = $.extend({}, Carousel.defaults, options);`
- Add methods to prototype: `Carousel.prototype.next = function() { };`

## Namespace Pattern
- Create namespace object: `var MyApp = MyApp || {};`
- Organize by type: `MyApp.config`, `MyApp.utils`, `MyApp.components`
- Pattern: `MyApp.components.Modal = { init: function(), show: function(), hide: function() }`

## DOM Manipulation Rules
- Batch DOM updates - build HTML string, insert once
- Use document fragments for multiple insertions: `$(document.createDocumentFragment())`
- Use `.detach()` for heavy manipulation, then reattach
- Use `.text()` for user content (XSS safe), not `.html()`
- Use `.html()` only for trusted/sanitized content

## Data Storage Patterns
- Use `.data()` for element-associated data: `$(this).data('price', 10);`
- Set multiple at once: `$('.item').data({ price: 10, stock: 5 });`
- Use `data-*` attributes in HTML for initial state
- jQuery auto-converts data attributes: `data-product-id="123"` → `$el.data('product-id')` returns number

## Performance Rules
- Minimize reflows: batch reads, then batch writes
- Use CSS classes instead of inline styles: `$('#el').addClass('visible')` over multiple `.css()` calls
- Debounce scroll/resize handlers: minimum 100-150ms delay
- Throttle continuous update handlers
- Index columns used in data filtering

Debounce pattern:
```javascript
function debounce(func, wait) {
  let timeout;
  return function() {
    const context = this;
    const args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(function() {
      func.apply(context, args);
    }, wait);
  };
}

$(window).on('scroll', debounce(handleScroll, 150));
```

Throttle pattern:
```javascript
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const context = this;
    const args = arguments;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(function() {
        inThrottle = false;
      }, limit);
    }
  };
}

$(window).on('scroll', throttle(updatePosition, 100));
```

## Error Handling
- Use try-catch for JSON parsing: `try { JSON.parse(str) } catch(e) { return null; }`
- Console logging for debugging with meaningful messages
- Graceful fallbacks for failed operations
- Loading states for async operations

## Initialization Pattern
- Use `$(document).ready()` short form: `$(function() { Module.init(); });`
- Include init call at bottom of JS files: `ModuleName.init();`
- Pattern for form/grid modules: `_{module}Grid.init();` or `_{module}Form.init();`

## Cleanup Pattern
- Always clean up when removing elements:
  - Clear intervals/timeouts: `clearInterval(this.timer);`
  - Remove namespaced events: `this.$element.off('.moduleName');`
  - Clear stored data: `this.$element.removeData();`
  - Null references: `this.$element = null;`

Example:
```javascript
var Widget = {
  init: function($element) {
    this.$element = $element;
    this.timer = setInterval(this.update.bind(this), 1000);
    this.$element.on('click.widget', this.handleClick.bind(this));
    return this;
  },
  
  destroy: function() {
    clearInterval(this.timer);
    this.$element.off('.widget');
    this.$element.removeData();
    this.$element = null;
  }
};
```

## Security Rules (Penetration Testing Prevention)

### XSS (Cross-Site Scripting) Prevention
- NEVER use `.html()` with user input - always use `.text()`
- NEVER use `innerHTML` with untrusted data - use `textContent`
- NEVER use `document.write()` - it's vulnerable and deprecated
- Sanitize any HTML that must be rendered: use DOMPurify or similar library
- Escape special characters in dynamic attribute values

```javascript
// ❌ VULNERABLE
$('#output').html(userInput);
element.innerHTML = userInput;
$('<div class="' + userInput + '">');

// ✅ SAFE
$('#output').text(userInput);
element.textContent = userInput;
$('<div>').addClass(sanitizedClass);
```

### Dangerous Functions - NEVER Use
- NEVER use `eval()` - allows arbitrary code execution
- NEVER use `new Function()` with user input
- NEVER use `setTimeout(string)` or `setInterval(string)` - use functions instead
- NEVER use `document.write()` or `document.writeln()`

```javascript
// ❌ VULNERABLE
eval(userInput);
new Function(userInput)();
setTimeout("doSomething('" + userInput + "')", 100);

// ✅ SAFE
JSON.parse(userInput); // For JSON data only
setTimeout(function() { doSomething(userInput); }, 100);
```

### URL and Parameter Handling
- NEVER trust URL parameters - always validate and sanitize
- Use `encodeURIComponent()` when building URLs with user data
- Validate redirect URLs against whitelist - prevent open redirects
- Never put sensitive data in URL parameters

```javascript
// ❌ VULNERABLE
window.location = userProvidedUrl;
var url = '/search?q=' + userInput;

// ✅ SAFE
if (allowedUrls.includes(userProvidedUrl)) {
  window.location = userProvidedUrl;
}
var url = '/search?q=' + encodeURIComponent(userInput);
```

### Input Validation
- Validate all input on client AND server - client validation is for UX only
- Use whitelist validation over blacklist when possible
- Validate data types, lengths, formats, and ranges
- Sanitize input before use, not just before display

```javascript
// Validate email format
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Validate against allowed values only
function isValidStatus(status) {
  var allowed = ['active', 'inactive', 'pending'];
  return allowed.indexOf(status) !== -1;
}

// Validate and limit length
function sanitizeInput(input, maxLength) {
  if (typeof input !== 'string') return '';
  return input.trim().substring(0, maxLength);
}
```

### Sensitive Data Handling
- NEVER store passwords, tokens, or API keys in JavaScript
- NEVER log sensitive data to console in production
- Clear sensitive form fields after submission
- Use `type="password"` for sensitive inputs
- Don't store sensitive data in localStorage/sessionStorage unencrypted

```javascript
// ❌ VULNERABLE
var apiKey = 'sk-12345-secret';
console.log('User password:', password);
localStorage.setItem('authToken', token);

// ✅ SAFE
// API keys should be server-side only
// Use httpOnly cookies for auth tokens (set by server)
$('#password').val(''); // Clear after use
```

### JSON Parsing Safety
- Always use `JSON.parse()` in try-catch
- Never use `eval()` to parse JSON
- Validate JSON structure after parsing

```javascript
function safeParseJSON(str) {
  try {
    var data = JSON.parse(str);
    if (typeof data !== 'object' || data === null) {
      return null;
    }
    return data;
  } catch (e) {
    console.error('Invalid JSON');
    return null;
  }
}
```

### Event Handler Security
- Validate data from `data-*` attributes before use
- Don't trust hidden form field values
- Validate IDs/GUIDs from DOM before using in operations

```javascript
// ❌ VULNERABLE - trusting DOM data directly
$('.delete-btn').on('click', function() {
  var id = $(this).data('id');
  deleteRecord(id); // No validation
});

// ✅ SAFE - validate before use
$('.delete-btn').on('click', function() {
  var id = $(this).data('id');
  if (isValidGUID(id)) {
    deleteRecord(id);
  }
});

function isValidGUID(guid) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guid);
}
```

### Prototype Pollution Prevention
- Never use user input as object property keys directly
- Use `Object.hasOwnProperty()` when iterating
- Consider using `Object.create(null)` for dictionaries

```javascript
// ❌ VULNERABLE
var obj = {};
obj[userInput] = value; // Can pollute __proto__

// ✅ SAFE
var obj = Object.create(null);
if (userInput !== '__proto__' && userInput !== 'constructor') {
  obj[userInput] = value;
}
```

### Third-Party Library Security
- Keep jQuery and all libraries updated to latest stable versions
- Remove unused libraries - reduce attack surface
- Verify library integrity with SRI (Subresource Integrity) hashes
- Audit dependencies for known vulnerabilities

## File Organization
- One component per file
- Structure: `/js/components/`, `/js/utils/`, `/js/pages/`
- Naming: `{module}_grid.js`, `{module}_form.js`

## Checklist
- [ ] jQuery selectors cached with `$` prefix
- [ ] Event delegation for dynamic elements
- [ ] Events namespaced for cleanup
- [ ] DOM updates batched
- [ ] User content uses `.text()` not `.html()`
- [ ] Scroll/resize handlers debounced/throttled
- [ ] Objects use clear patterns (literal, module, constructor)
- [ ] Private data encapsulated
- [ ] Components have `init()` and `destroy()` methods
- [ ] Init call at bottom of JS files

## Security Checklist
- [ ] No `.html()` or `innerHTML` with user input
- [ ] No `eval()`, `new Function()`, or string-based setTimeout
- [ ] No sensitive data in client-side code
- [ ] All user input validated and sanitized
- [ ] URL parameters encoded with `encodeURIComponent()`
- [ ] Redirect URLs validated against whitelist
- [ ] JSON parsed with try-catch, never eval
- [ ] Data from DOM attributes validated before use
- [ ] No prototype pollution vulnerabilities
- [ ] Third-party libraries up to date
