import browser from "webextension-polyfill";

export type DescriptionSuggestion = {
  text: string;
  source: string;
};

const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Truncate text to a maximum length, breaking at a word boundary.
 */
export function truncateText(
  text: string,
  maxLength = MAX_DESCRIPTION_LENGTH,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength);
  // Break at the last whitespace to avoid cutting mid-word
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Build a description string that always includes the page URL as source.
 */
export function buildDescription(body: string, url?: string): string {
  const parts: string[] = [];
  if (body.trim()) parts.push(body.trim());
  if (url) parts.push(`Source: ${url}`);
  return parts.join("\n\n");
}

/**
 * Inject a script into the given tab to extract description suggestions from
 * JSON-LD, Microdata, Open Graph / meta tags, and leading page content.
 * Returns up to 5 deduplicated suggestions.
 */
export async function extractDescriptionSuggestions(
  tabId: number,
): Promise<DescriptionSuggestion[]> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        type Suggestion = { text: string; source: string };
        const suggestions: Suggestion[] = [];
        const MAX_LEN = 500;

        function truncate(raw: string): string {
          const t = raw.trim();
          if (t.length <= MAX_LEN) return t;
          const cut = t.slice(0, MAX_LEN);
          const ls = cut.lastIndexOf(" ");
          return `${ls > MAX_LEN * 0.5 ? cut.slice(0, ls) : cut}…`;
        }

        // 1. JSON-LD structured data (schema.org/Event description)
        const jsonLdScripts = document.querySelectorAll(
          'script[type="application/ld+json"]',
        );
        for (const script of jsonLdScripts) {
          try {
            const data = JSON.parse(script.textContent || "");
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              const nodes = item["@graph"] ? item["@graph"] : [item];
              for (const node of nodes) {
                const types = Array.isArray(node["@type"])
                  ? node["@type"]
                  : [node["@type"]];
                if (types.includes("Event") && node.description) {
                  suggestions.push({
                    text: truncate(node.description),
                    source: "Event (structured data)",
                  });
                }
              }
            }
          } catch {
            /* ignore JSON parse errors */
          }
        }

        // 2. Microdata (schema.org/Event description)
        const microdataEvents = document.querySelectorAll(
          '[itemtype*="schema.org/Event"]',
        );
        for (const event of microdataEvents) {
          const descEl = event.querySelector('[itemprop="description"]');
          if (descEl) {
            const text =
              descEl.getAttribute("content") || descEl.textContent || "";
            if (text.trim()) {
              suggestions.push({
                text: truncate(text),
                source: "Event (Microdata)",
              });
            }
          }
        }

        // 3. Open Graph description
        const ogDesc = document.querySelector(
          'meta[property="og:description"]',
        );
        if (ogDesc) {
          const content = ogDesc.getAttribute("content");
          if (content?.trim()) {
            suggestions.push({
              text: truncate(content),
              source: "Open Graph",
            });
          }
        }

        // 4. Standard meta description (only if different from OG)
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          const content = metaDesc.getAttribute("content");
          if (content?.trim()) {
            const ogText = suggestions.find(
              (s) => s.source === "Open Graph",
            )?.text;
            if (!ogText || ogText !== truncate(content)) {
              suggestions.push({
                text: truncate(content),
                source: "Meta description",
              });
            }
          }
        }

        // 5. First meaningful paragraph from <article> or <main>
        const container =
          document.querySelector("article") || document.querySelector("main");
        if (container) {
          const paragraphs = container.querySelectorAll("p");
          for (const p of paragraphs) {
            const text = p.textContent?.trim();
            if (text && text.length > 20) {
              suggestions.push({
                text: truncate(text),
                source: "Page content",
              });
              break;
            }
          }
        }

        // Deduplicate by text content
        const seen = new Set<string>();
        return suggestions.filter((s) => {
          if (seen.has(s.text)) return false;
          seen.add(s.text);
          return true;
        }).slice(0, 5);
      },
    });

    return (results?.[0]?.result as DescriptionSuggestion[]) ?? [];
  } catch (e) {
    console.log("Could not extract description suggestions", e);
    return [];
  }
}

/**
 * Inject a script into the given tab to find the text of the next sibling
 * block element after the current selection. Useful when a user selects a
 * heading and we want to suggest the following paragraph as description.
 *
 * Must be called while the selection is still active (i.e. from the
 * background script before the popup steals focus).
 */
export async function extractSelectionSiblingText(
  tabId: number,
): Promise<string | null> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        const MAX_LEN = 500;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;

        const range = selection.getRangeAt(0);
        let node: Node | null = range.startContainer;

        // Walk up to the nearest block-level element
        while (node && node !== document.body) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const display = window.getComputedStyle(el).display;
            if (
              display === "block" ||
              display === "flex" ||
              display === "grid" ||
              display === "list-item"
            ) {
              break;
            }
          }
          node = node.parentElement;
        }

        if (!node || node === document.body || !(node instanceof HTMLElement))
          return null;

        // Walk forward through sibling elements looking for text content
        let sibling = node.nextElementSibling;
        while (sibling) {
          const text = sibling.textContent?.trim();
          if (text && text.length > 10) {
            if (text.length <= MAX_LEN) return text;
            const cut = text.slice(0, MAX_LEN);
            const ls = cut.lastIndexOf(" ");
            return `${ls > MAX_LEN * 0.5 ? cut.slice(0, ls) : cut}…`;
          }
          sibling = sibling.nextElementSibling;
        }

        return null;
      },
    });

    return (results?.[0]?.result as string) ?? null;
  } catch (e) {
    console.log("Could not extract selection sibling text", e);
    return null;
  }
}
