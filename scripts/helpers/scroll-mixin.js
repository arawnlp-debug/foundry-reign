// scripts/helpers/scroll-mixin.js

/**
 * A mixin that preserves scroll positions across V14 ApplicationV2 re-renders.
 * Without this, any call to `_replaceHTML` resets all scrollable containers to the top.
 *
 * Usage:
 *   class MySheet extends HandlebarsApplicationMixin(ScrollPreserveMixin(ActorSheetV2)) { ... }
 *
 * The selector list covers all scrollable containers used across the Reign system:
 * sheet bodies, health panels, spell lists, charactermancer panels, faction dashboard, etc.
 */
const SCROLL_SELECTORS = '.window-content, .sheet-body, .reign-scroll-y, .reign-spell-scroll, .reign-health-data-list, .cm-results-left, .cm-biography, .cm-editor, .cp-results-left, .cp-summary-right, .fd-table-container';

export const ScrollPreserveMixin = (Base) => class extends Base {
  _replaceHTML(result, content, options) {
    const scrollMap = new Map();

    if (this.element) {
      const scrollers = this.element.querySelectorAll(SCROLL_SELECTORS);
      scrollers.forEach((el, index) => scrollMap.set(index, el.scrollTop));
    }

    super._replaceHTML(result, content, options);

    if (this.element) {
      const newScrollers = this.element.querySelectorAll(SCROLL_SELECTORS);
      newScrollers.forEach((el, index) => {
        if (scrollMap.has(index)) el.scrollTop = scrollMap.get(index);
      });
    }
  }
};