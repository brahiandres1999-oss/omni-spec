import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// happy-dom does not implement the `draggable` IDL attribute; browsers reflect it (false by default except
// for images and links with href). VB-05 reads the property, so the environment provides it.
if (typeof HTMLElement !== 'undefined' && !('draggable' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'draggable', {
    configurable: true,
    get(this: HTMLElement) {
      const value = this.getAttribute('draggable');
      if (value === 'true') return true;
      if (value === 'false') return false;
      return this.localName === 'img' || (this.localName === 'a' && this.hasAttribute('href'));
    },
    set(this: HTMLElement, value: boolean) {
      this.setAttribute('draggable', String(Boolean(value)));
    },
  });
}

// The governance-view tests predate the chat tab: they start from the layout that opened on Kanban. Chat
// tests clear this key to get the real first-run default.
beforeEach(() => {
  globalThis.localStorage?.setItem(
    'omni-studio:layout.v2',
    JSON.stringify({ inspectorCollapsed: false, inspectorTab: 'overview', stageTab: 'kanban' }),
  );
});

afterEach(() => {
  cleanup();
  // The static design scan runs in the node environment, where there is no localStorage.
  globalThis.localStorage?.clear();
});
