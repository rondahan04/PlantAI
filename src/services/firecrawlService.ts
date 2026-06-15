const FIRECRAWL_URL = 'https://api.firecrawl.dev/v1/scrape';

export interface FirecrawlPlant {
  name: string;
  price: string;
  inStock: boolean;
}

export interface FirecrawlResult {
  nurseryId: string;
  plants: FirecrawlPlant[];
  scrapedAt: string;
}

/*
 * Scrapes a nursery website via Firecrawl REST API and returns raw markdown.
 * Caller is responsible for parsing plant data from the markdown.
 */
export async function scrapeUrl(url: string, apiKey: string): Promise<string> {
  const response = await fetch(FIRECRAWL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl error ${response.status} for ${url}`);
  }

  const data = await response.json();
  return data.data?.markdown ?? '';
}

/*
 * Extracts plant inventory from scraped markdown using OpenAI.
 * Returns array of plants with name, price, and stock status.
 */
export async function extractPlantsFromMarkdown(
  markdown: string,
  nurseryName: string,
  openAiKey: string
): Promise<FirecrawlPlant[]> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Extract all plant products from this ${nurseryName} website content. Return ONLY valid JSON array:
[{ "name": "plant scientific name", "price": "₪XX", "inStock": true }]
If no plants found, return [].
Content:\n${markdown.slice(0, 3000)}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 800,
    }),
  });

  if (!response.ok) return [];

  try {
    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return Array.isArray(parsed) ? parsed : (parsed.plants ?? []);
  } catch {
    return [];
  }
}
