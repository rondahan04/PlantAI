/*
 * Product-page follow: pricing a shop whose catalogue page lists products and
 * no prices.
 *
 * WHY THIS EXISTS. A search page that answers correctly but prices nothing is
 * indistinguishable, downstream, from a shop that does not stock the plant.
 * Every row the extractor proposes is dropped for want of a price (coercePlants
 * requires one), the funnel closes at `no_match`, and `no_match` is the stage
 * that means "we read a real catalogue and the plant was not in it" - so the
 * user is told a shop does not sell a plant it has on the shelf, and the shop
 * is hidden from the results entirely.
 *
 * mashtela-urbanit.co.il is the case that forced it. Its Joomla core search
 * returns the right products by name and link:
 *
 *   /catalog/home-office/like-light/מונסטרה-detail
 *   /catalog/home-office/like-light/מונסטרה-מאנקי-detail
 *
 * and states no price anywhere on that page. The price is one plain GET away -
 * `<span class="PricesalesPrice">49 ₪` on the product page, server-rendered,
 * no JavaScript needed.
 *
 * Deliberately NOT keyed on VirtueMart. The trigger is the condition, not the
 * vendor: catalogue read, zero prices, product links present. A funnel tally
 * over the live fan-out found eight other zero-price sites behind the same
 * shape, and a rule written around one platform would leave every one of them
 * exactly where it is.
 *
 *   productLinks(html, baseUrl, plan)  ─▶ ranked, deduped, same-origin
 *           │                              {name, url}[] capped at 5
 *   followProductPages({links, ...})   ─▶ one GET + one extraction per link
 *           │                              failures isolated per page
 *           ─▶ { plants, followed, priced }
 */
import { parse as parseHtml, defaultTreeAdapter } from 'parse5';

import { scoreCandidate, type QueryPlan } from './queryPlan.ts';
import type { Plant, PipelineResult } from './core.ts';

/*
 * How many product pages one shop is worth.
 *
 * Each is a GET against someone else's server plus a model call, inside the
 * 45s per-site budget the pipeline already enforces. Five because a shop
 * commonly lists the same plant in several pot sizes and the Pick Up tab sorts
 * cheapest-first - following only the top match would pick a variant before
 * knowing any price, and show a number that is not the cheapest one.
 */
export const PRODUCT_FOLLOW_MAX = 5;

/*
 * The floor an anchor's text must clear to be worth a fetch.
 *
 * PLAUSIBLE_MATCH in queryPlan.ts is the same idea and is not exported; the
 * value is restated rather than imported to keep this module from widening
 * that module's surface. Any score above zero means the genus is in the title,
 * which is exactly the bar wanted here: the adjudication that separates a
 * cultivar from its cousin happens later, on the priced rows, where it can be
 * asked about a real product rather than about a link.
 */
const LINK_FLOOR = 0.05;

/* A link worth opening: the product's name as the page wrote it, and where. */
export interface ProductLink {
  name: string;
  url: string;
}

type Node = any;

function children(node: Node): Node[] {
  return (node.childNodes ?? []) as Node[];
}

function attr(node: Node, name: string): string {
  if (!defaultTreeAdapter.isElementNode(node)) return '';
  const found = (node.attrs ?? []).find((a: any) => a.name === name);
  return found ? String(found.value) : '';
}

function textOf(node: Node): string {
  let out = '';
  if (defaultTreeAdapter.isTextNode(node)) out += node.value;
  for (const child of children(node)) out += textOf(child);
  return out.replace(/\s+/g, ' ').trim();
}

function walk(node: Node, visit: (n: Node) => void): void {
  for (const child of children(node)) {
    visit(child);
    walk(child, visit);
  }
}

/* Resolve a possibly-relative href against the page it came from. */
function absolute(href: string, baseUrl: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, baseUrl || undefined).toString();
  } catch {
    return undefined;
  }
}

/*
 * The links on this page that look like the plant, best first.
 *
 * Pure, so the whole ranking is testable against a captured page with no
 * network. Three things disqualify a link and each one was observed on a real
 * search page:
 *
 *   - a different origin. Shops link their suppliers, their Instagram and a
 *     WhatsApp number; following those spends a fetch on something that can
 *     never be a product of this shop.
 *   - an unopenable scheme. `mailto:`, `tel:` and `javascript:` are anchors too.
 *   - text that does not name the plant. mashtela's own search page links its
 *     cart, its FAQ and a bag of potting mix alongside the monstera.
 *
 * The same product linked twice - once from its thumbnail, once from its title -
 * is one product. The anchor that carries text wins, because an image link has
 * no name to show the user.
 */
export function productLinks(
  html: string,
  baseUrl: string,
  plan: QueryPlan,
  max = PRODUCT_FOLLOW_MAX
): ProductLink[] {
  if (!(html || '').trim()) return [];

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  /* Keyed by URL so the thumbnail and the title collapse into one row. */
  const best = new Map<string, { name: string; url: string; score: number }>();

  walk(parseHtml(html), (node) => {
    if (!defaultTreeAdapter.isElementNode(node)) return;
    if (node.tagName !== 'a') return;

    const href = attr(node, 'href').trim();
    if (!href || /^(?:mailto|tel|javascript):/i.test(href)) return;

    const url = absolute(href, baseUrl);
    if (!url) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.origin !== origin) return;

    /*
     * The fragment is not part of a product's identity: a page that links
     * `/x-detail` and `/x-detail#reviews` is linking one product twice, and
     * following both spends a fetch to read the same page again.
     */
    parsed.hash = '';
    const clean = parsed.toString();

    const name = textOf(node);
    const score = name ? scoreCandidate(name, plan) : 0;
    /*
     * An untitled anchor - the thumbnail - cannot be scored, so it is kept only
     * as an alias of a titled one that resolves to the same URL. Admitting it
     * on its own would mean following every image on the page.
     */
    if (score < LINK_FLOOR) {
      if (!name && best.has(clean)) return;
      if (!name) return;
      return;
    }

    const prior = best.get(clean);
    if (!prior || score > prior.score) best.set(clean, { name, url: clean, score });
  });

  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ name, url }) => ({ name, url }));
}

/* The extraction pass, injected so this module never reaches the network. */
type ExtractOnce = (opts: {
  markdown: string;
  query: string;
  site: string;
  html?: string;
  url?: string;
  plan?: QueryPlan;
  openaiKey?: string;
}) => Promise<PipelineResult>;

/*
 * How long the whole follow may take.
 *
 * It spends its fetches and model calls INSIDE the pipeline's 45s per-site
 * budget (SITE_BUDGET_MS), so an unbounded rescue does not merely run long - it
 * can cost a shop the read it would otherwise have had. Measured over a live
 * Tel Aviv fan-out, an unbounded follow took timeouts from 1 to 3 while adding
 * one priced shop: a bad trade, and an invisible one, because a site that times
 * out reports as unreadable rather than as "the rescue overran".
 *
 * Ten seconds is a fifth of that budget, and comfortably more than the ~2-5s a
 * parallel five-page follow actually needs.
 */
export const PRODUCT_FOLLOW_BUDGET_MS = 10_000;

export interface FollowOpts {
  links: ProductLink[];
  query: string;
  site: string;
  openaiKey?: string;
  plan?: QueryPlan;
  /* Override the follow's own ceiling; tests set it small. */
  budgetMs?: number;
  /* One plain GET. The caller supplies it; raw HTML is enough for every
   * product page this rescues, and none of them needs rendering. */
  fetchProductHtml: (url: string) => Promise<string>;
  extract: ExtractOnce;
}

export interface FollowResult {
  plants: Plant[];
  /* Pages opened, and how many of them yielded a price. Both travel into the
   * funnel: a follow that opens five pages and prices none is a different
   * failure from a shop with no product links at all, and only the counts tell
   * them apart. */
  followed: number;
  priced: number;
  /* The follow ran out of its own time. Distinct from "priced nothing": one is
   * a shop whose product pages do not state prices, the other is a shop we
   * stopped asking. */
  timedOut: boolean;
}

/*
 * Open each product page and ask what it costs.
 *
 * Failures are isolated per page on purpose. This runs on a paid scrape the
 * user is already waiting for, and one shop's dead variant link must not cost
 * the sibling that would have answered - so a fetch that throws, a page that
 * prices nothing, and a model call that fails all narrow the result rather than
 * emptying it.
 *
 * Every returned row carries the product page it was priced FROM, not the
 * search page it was found on. The Order button opens `productUrl`, and sending
 * a user to a search result they have to re-find the plant in is most of the
 * work we just did for them.
 */
export async function followProductPages(opts: FollowOpts): Promise<FollowResult> {
  const {
    links,
    query,
    site,
    openaiKey,
    plan,
    fetchProductHtml,
    extract,
    budgetMs = PRODUCT_FOLLOW_BUDGET_MS,
  } = opts;
  if (links.length === 0) return { plants: [], followed: 0, priced: 0, timedOut: false };

  const work = Promise.all(
    links.map(async (link): Promise<Plant[]> => {
      try {
        const html = await fetchProductHtml(link.url);
        if (!(html || '').trim()) return [];
        const { plants } = await extract({
          /*
           * The page goes in as HTML, not markdown. The structured readers in
           * structuredPrice.ts run off HTML and a product page is where they
           * are strongest - JSON-LD, microdata and a priced card are all page
           * furniture there, where a search listing carries none of it.
           */
          markdown: '',
          query,
          site,
          html,
          url: link.url,
          plan,
          openaiKey,
        });
        /*
         * The link's URL, not whatever the extractor inferred. The extractor is
         * reading one product's page, so the product IS this page - and a model
         * that volunteers a different URL is guessing at a page it cannot see.
         */
        return plants.map((p) => ({ ...p, url: link.url }));
      } catch {
        /* One unreachable product is not an unreadable shop. */
        return [];
      }
    })
  );

  /*
   * Abandoned rather than awaited on expiry. The in-flight fetches are left to
   * settle on their own - there is nothing to cancel that would un-spend them -
   * but the shop stops waiting, which is the only part that costs it its read.
   */
  const EXPIRED = Symbol('follow-expired');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof EXPIRED>((resolve) => {
    timer = setTimeout(() => resolve(EXPIRED), budgetMs);
  });

  try {
    const settled = await Promise.race([work, expiry]);
    if (settled === EXPIRED) {
      console.log(`   [${site}] 🔗 follow abandoned after ${budgetMs}ms`);
      return { plants: [], followed: links.length, priced: 0, timedOut: true };
    }
    return {
      plants: settled.flat(),
      followed: links.length,
      priced: settled.filter((rows) => rows.length > 0).length,
      timedOut: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
