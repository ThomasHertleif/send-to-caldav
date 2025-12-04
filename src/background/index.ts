/// <reference types="firefox-webext-browser" />
import browser from "webextension-polyfill";

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

    // Store this context so the popup can pick it up
    // Timestamp so the popup can decide if the data is fresh
    const contextMenuData: ContextMenuData = {
      url: targetUrl,
      title,
      selection: info.selectionText || "",
      timestamp: Date.now(),
    };
    browser.storage.local.set({ contextMenuData });

    // Open the popup
    // Firefox supports opening popup from context menu.
    // Chrome requires opening a window.
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
  }
});
