/// <reference types="firefox-webext-browser" />

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "send-to-cal-ctx",
    title: "Send to Calendar",
    contexts: ["page", "link", "selection"],
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "send-to-cal-ctx") {
    // Determine the URL to use
    let targetUrl = info.pageUrl;
    let title = tab?.title || "";
    // If a link was clicked, use the link URL instead of the page URL
    if (info.linkUrl) {
      targetUrl = info.linkUrl;
      title = info.linkText || title;
    }

    // Store this context so the popup can pick it up
    // We include a timestamp so the popup can decide if the data is fresh enough
    browser.storage.local.set({
      contextMenuData: {
        url: targetUrl,
        title,
        selection: info.selectionText || "",
        timestamp: Date.now(),
      },
    });

    // Open the popup
    // This is specific to Firefox and requires the user interaction (context menu click)
    browser.action.openPopup();
  }
});
