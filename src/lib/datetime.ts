import browser from "webextension-polyfill";

export type DateTimeSuggestion = {
  start: string; // ISO string
  end?: string; // ISO string
  label: string;
};

export function toLocalIsoString(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Given a YYYY-MM-DD date string, return sensible start/end Date objects for
 * restoring datetime-local inputs after the user unchecks "All day".
 * If the date is today, snap to the next whole hour; otherwise default to 9 AM.
 */
export function restoreDateTime(dateOnly: string): { start: Date; end: Date } {
  const todayStr = new Date().toISOString().slice(0, 10);
  let start: Date;

  if (dateOnly === todayStr) {
    start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
  } else {
    start = new Date(`${dateOnly}T09:00:00`);
  }

  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  return { start, end };
}

/**
 * Format a DateTimeSuggestion into a human-readable string for display in the
 * suggestion chips.
 */
export function formatSuggestion(s: DateTimeSuggestion): string {
  const start = new Date(s.start);
  const dateOpts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };

  const hasTime = start.getHours() !== 0 || start.getMinutes() !== 0;

  if (s.end) {
    const end = new Date(s.end);
    const sameDay = start.toDateString() === end.toDateString();
    if (sameDay) {
      if (hasTime) {
        return `${start.toLocaleDateString(undefined, dateOpts)}, ${start.toLocaleTimeString(undefined, timeOpts)} – ${end.toLocaleTimeString(undefined, timeOpts)}`;
      }
      return start.toLocaleDateString(undefined, dateOpts);
    }
    if (hasTime) {
      return `${start.toLocaleDateString(undefined, dateOpts)} ${start.toLocaleTimeString(undefined, timeOpts)} – ${end.toLocaleDateString(undefined, dateOpts)} ${end.toLocaleTimeString(undefined, timeOpts)}`;
    }
    return `${start.toLocaleDateString(undefined, dateOpts)} – ${end.toLocaleDateString(undefined, dateOpts)}`;
  }

  if (hasTime) {
    return `${start.toLocaleDateString(undefined, dateOpts)}, ${start.toLocaleTimeString(undefined, timeOpts)}`;
  }
  return start.toLocaleDateString(undefined, dateOpts);
}

/**
 * Inject a script into the given tab to extract date/time suggestions from the
 * page using JSON-LD, Microdata, <time> elements, and meta tags.
 * Returns up to 5 deduplicated suggestions.
 */
export async function extractDateSuggestions(
  tabId: number,
): Promise<DateTimeSuggestion[]> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        type Suggestion = {
          start: string;
          end?: string;
          label: string;
        };

        const suggestions: Suggestion[] = [];

        function tryParseDate(value: string): Date | null {
          const d = new Date(value);
          return Number.isNaN(d.getTime()) ? null : d;
        }

        // 1. JSON-LD structured data (schema.org/Event)
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
                if (types.includes("Event")) {
                  const start = tryParseDate(node.startDate);
                  if (start) {
                    const end = node.endDate
                      ? tryParseDate(node.endDate)
                      : null;
                    suggestions.push({
                      start: start.toISOString(),
                      end: end ? end.toISOString() : undefined,
                      label: node.name || "Event",
                    });
                  }
                }
              }
            }
          } catch {
            // ignore JSON parse errors
          }
        }

        // 2. Microdata (schema.org/Event)
        const microdataEvents = document.querySelectorAll(
          '[itemtype*="schema.org/Event"]',
        );
        for (const event of microdataEvents) {
          const startEl = event.querySelector('[itemprop="startDate"]');
          const endEl = event.querySelector('[itemprop="endDate"]');
          const nameEl = event.querySelector('[itemprop="name"]');
          if (startEl) {
            const startStr =
              startEl.getAttribute("datetime") ||
              startEl.getAttribute("content") ||
              startEl.textContent;
            const start = tryParseDate(startStr || "");
            if (start) {
              let end: string | undefined;
              if (endEl) {
                const endStr =
                  endEl.getAttribute("datetime") ||
                  endEl.getAttribute("content") ||
                  endEl.textContent;
                const endDate = tryParseDate(endStr || "");
                if (endDate) end = endDate.toISOString();
              }
              suggestions.push({
                start: start.toISOString(),
                end,
                label: nameEl?.textContent?.trim() || "Event",
              });
            }
          }
        }

        // 3. <time> elements with datetime attributes
        const timeElements = document.querySelectorAll("time[datetime]");
        for (const el of timeElements) {
          const datetime = el.getAttribute("datetime");
          if (!datetime) continue;
          const date = tryParseDate(datetime);
          if (!date) continue;
          // Skip year-only or ISO duration values
          if (/^P/.test(datetime) || /^\d{4}$/.test(datetime)) continue;
          suggestions.push({
            start: date.toISOString(),
            label: el.textContent?.trim() || "Page date",
          });
        }

        // 4. Meta tags with date information
        const metaSelectors = [
          {
            sel: 'meta[property="article:published_time"]',
            label: "Published",
          },
          { sel: 'meta[property="article:modified_time"]', label: "Modified" },
          { sel: 'meta[property="event:start_time"]', label: "Event start" },
          { sel: 'meta[name="date"]', label: "Page date" },
          { sel: 'meta[name="DC.date"]', label: "Page date" },
        ];
        for (const { sel, label } of metaSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const content = (el as HTMLMetaElement).getAttribute("content");
            if (content) {
              const date = tryParseDate(content);
              if (date) {
                suggestions.push({ start: date.toISOString(), label });
              }
            }
          }
        }

        // Deduplicate by start+end key, limit to 5
        const seen = new Set<string>();
        const unique: Suggestion[] = [];
        for (const s of suggestions) {
          const key = `${s.start}|${s.end ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(s);
          if (unique.length >= 5) break;
        }

        return unique;
      },
    });

    return (results?.[0]?.result as DateTimeSuggestion[]) ?? [];
  } catch (e) {
    console.log("Could not extract date/time suggestions", e);
    return [];
  }
}
