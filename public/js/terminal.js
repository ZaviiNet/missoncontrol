const MAX_ENTRIES = 100;
const TYPING_SPEED = 12; // ms per character

const TYPE_COLORS = {
  info: 'type-info',
  error: 'type-error',
  agent: 'type-agent',
  tool: 'type-tool',
  system: 'type-system',
};

let container = null;
let entryCount = 0;

export function init(elementId) {
  container = document.getElementById(elementId);
}

export function log(text, type = 'info', animate = false) {
  if (!container) return;

  const entry = document.createElement('div');
  entry.className = `log-entry ${TYPE_COLORS[type] || 'type-info'}`;

  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  const timestamp = document.createElement('span');
  timestamp.className = 'timestamp';
  timestamp.textContent = ts;
  entry.appendChild(timestamp);

  const content = document.createElement('span');
  entry.appendChild(content);

  container.appendChild(entry);
  entryCount++;

  // Trim old entries
  while (entryCount > MAX_ENTRIES) {
    container.removeChild(container.firstChild);
    entryCount--;
  }

  if (animate && text.length < 200) {
    typeText(content, text, () => scrollToBottom());
  } else {
    content.textContent = text;
    scrollToBottom();
  }
}

function typeText(element, text, onDone) {
  let i = 0;
  element.classList.add('cursor-blink');
  const interval = setInterval(() => {
    element.textContent = text.slice(0, ++i);
    scrollToBottom();
    if (i >= text.length) {
      clearInterval(interval);
      element.classList.remove('cursor-blink');
      if (onDone) onDone();
    }
  }, TYPING_SPEED);
}

function scrollToBottom() {
  container.scrollTop = container.scrollHeight;
}

export function clear() {
  if (!container) return;
  container.innerHTML = '';
  entryCount = 0;
}
