/// <reference types="firefox-webext-browser" />
import browser from "webextension-polyfill";
import { extractSelectionSiblingText } from "../lib/description";

export type ContextMenuData = {
  url?: string;
  title: string;
  selection: string;
  timestamp: number;
};

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "send-to-cal-ctx",
    title: "Send to Calendar",
    contexts: ["page", "link", "selection"],
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "send-to-cal-ctx") {
    let targetUrl = info.pageUrl;
    let title = tab?.title || "";

    // If a link was clicked
    if (info.linkUrl) {
      targetUrl = info.linkUrl;
      title = info.linkText || title;
    }

    // Store context data immediately so the popup can pick it up.
    // siblingText is populated asynchronously below and written in a
    // follow-up storage update; the popup's storage.onChanged listener
    // will pick it up.
    const contextMenuData: ContextMenuData = {
      url: targetUrl,
      title,
      selection: info.selectionText || "",
      timestamp: Date.now(),
    };
    browser.storage.local.set({ contextMenuData });

    // Open the popup synchronously – openPopup() requires the user
    // gesture to still be active, so it must run before any await.
    if (browser.action.openPopup) {
      browser.action.openPopup();
    } else {
      browser.windows.create({
        url: browser.runtime.getURL("src/popup/index.html"),
        type: "popup",
        width: 380,
        height: 600,
      });
    }

    // When the user selected text, grab the next sibling element's text
    // (e.g. the paragraph after a heading) asynchronously and push it
    // into storage so the popup can show it as a description suggestion.
    if (info.selectionText && tab?.id) {
      extractSelectionSiblingText(tab.id).then((result) => {
        if (result) {
          browser.storage.local.set({
            contextMenuSiblingText: { text: result, timestamp: Date.now() },
          });
        }
      });
    }
  }
});
