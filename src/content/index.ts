// Listen for messages from the popup
browser.runtime.onMessage.addListener(
  (message: { type: string }, _sender, _sendResponse) => {
    if (message.type === "SCRAPE_PAGE") {
      const data = scrapePage();
      return Promise.resolve(data);
    }
    return false; // Return false if we didn't handle the message
  },
);

function scrapePage() {
  let title = document.title;
  let description = "";

  // Try to get OpenGraph title if available, might be cleaner than document.title
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    const content = ogTitle.getAttribute("content");
    if (content) title = content;
  }

  // Try to get description from meta tags
  const metaDesc = document.querySelector('meta[name="description"]');
  const ogDesc = document.querySelector('meta[property="og:description"]');

  if (ogDesc) {
    const content = ogDesc.getAttribute("content");
    if (content) description = content;
  } else if (metaDesc) {
    const content = metaDesc.getAttribute("content");
    if (content) description = content;
  }

  // Basic cleanup
  title = title.trim();
  description = description.trim();

  return {
    title,
    description,
  };
}
