/*
 * Structured price extraction: read the price the page already states in
 * machine-readable form, before any model is asked to re-read it.
 *
 * Why this exists (SCRAPE-ACCURACY-PLAN, Phase 1). The pipeline scrapes a page
 * to markdown and hands an excerpt to an LLM. Markdown conversion deletes every
 * structured signal the page carries, so we pay a model to guess at a number
 * the shop published exactly. Worse, the line-based excerpt can separate a name
 * from its price, and a mis-pairing is silent.
 *
 * What the pages actually contain. The plan assumed JSON-LD `Product.offers`
 * would carry us; measured against the 26 captured fixtures it does not, because
 * we scrape SEARCH pages and Product JSON-LD lives on PRODUCT pages. A search
 * page emits `CollectionPage`/`Organization` and nothing priced. So this module
 * reads four sources, in descending order of how much the page is promising:
 *
 *   1. JSON-LD    Product / ItemList / offers. Exact when present (product
 *                 pages, and the minority of shops that mark up their grid).
 *   2. microdata  itemprop="price" inside an itemscope. Same guarantee.
 *   3. meta tags  og:price:amount / product:price:amount. One price per page,
 *                 so it only speaks for a product page.
 *   4. product cards  the grid itself: a container holding one product
 *                 permalink and one price. Not a standard, but it is still the
 *                 shop's own DOM, and crucially the container GUARANTEES the
 *                 name and the price belong together - which is the pairing
 *                 evidence markdown throws away.
 *
 * Everything here is pure: HTML in, products out, no network and no model. That
 * is the point - there is no hallucination surface at all.
 */

import { parse, defaultTreeAdapter } from 'parse5';

export interface StructuredProduct {
  name: string;
  /* Numeric price as written by the page. Currency is carried separately. */
  price: number;
  /* ISO code where the page stated one, else '' - callers assume ILS. */
  currency: string;
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
  /* Absolute product URL when the source carried one. */
  url?: string;
  /* Which reader produced this row, for the accuracy report. The four HTML
   * readers below, plus 'api' for a row that came from the shop's own
   * storefront JSON (scraper/platformApi.ts) and never touched HTML at all. */
  source: 'jsonld' | 'microdata' | 'meta' | 'card' | 'api';
}

// --- tiny DOM helpers over parse5 -------------------------------------------
//
// parse5 gives a spec-correct tree and nothing else, so these five helpers are
// the whole query layer. A real DOM library would be a heavier dependency for
// work this narrow.

type Node = any;

function isElement(node: Node): boolean {
  return defaultTreeAdapter.isElementNode(node);
}

function children(node: Node): Node[] {
  return (node.childNodes ?? []) as Node[];
}

function attr(node: Node, name: string): string {
  if (!isElement(node)) return '';
  const found = (node.attrs ?? []).find((a: any) => a.name === name);
  return found ? String(found.value) : '';
}

/* Depth-first walk, visitor may stop descending by returning false. */
function walk(node: Node, visit: (n: Node) => boolean | void): void {
  for (const child of children(node)) {
    if (visit(child) === false) continue;
    walk(child, visit);
  }
}

/* All text under a node, whitespace-collapsed. */
function textOf(node: Node): string {
  let out = '';
  if (defaultTreeAdapter.isTextNode(node)) out += node.value;
  for (const child of children(node)) out += textOf(child);
  return out.replace(/\s+/g, ' ').trim();
}

function hasClass(node: Node, re: RegExp): boolean {
  return re.test(attr(node, 'class'));
}

// --- price parsing ----------------------------------------------------------

/*
 * A price string to a number. Deliberately strict about which separator is the
 * decimal point: Israeli shops write "1,499.90" (comma = thousands) and never
 * the European "1.499,90", so a comma is always dropped and a dot always kept.
 * Guessing the other way turned ₪1,499.90 into ₪1.49990 in an early draft.
 */
export function parsePriceNumber(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/[‎‏‪-‮]/g, '') // bidi marks: Hebrew pages are full of them
    .replace(/&#8362;|&#x20aa;/gi, '₪');
  /*
   * The FIRST number token, not every digit in the string. Stripping all
   * non-digits and parsing the remainder turned a WooCommerce sale block -
   * "₪699.00 המחיר המקורי היה: ₪699.00. ₪499.90" - into the price 699.00699,
   * a number that appears nowhere on the page. A confidently wrong price is
   * worse than no price, so the parse is now anchored to one token.
   */
  const match = cleaned.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number.parseFloat(match[0].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/*
 * A price is only a price if the text also carries a currency. Without this a
 * product card's "4.8 stars", "2 reviews" or a litre size reads as a price.
 * Matches the ILS symbol in entity form too, since we parse raw HTML here and
 * WooCommerce emits `&#8362;`.
 */
/*
 * The bare word שח needs a boundary so it does not match inside ordinary Hebrew
 * words (שחור, משחה), but `\b` cannot supply one: JavaScript word boundaries are
 * ASCII, so there is no boundary between a space and ש and `\bשח\b` matches
 * nothing at all. Hence explicit Hebrew-block lookarounds.
 */
const CURRENCY_RE =
  /₪|&#8362;|&#x20aa;|ש"ח|ש״ח|(?<![֐-׿])שח(?![֐-׿])|NIS|ILS/i;

export function hasCurrency(s: string): boolean {
  return CURRENCY_RE.test(s);
}

/*
 * Availability from free text. Hebrew first: אזל / אזל המלאי is how every one of
 * the captured shops says sold out.
 */
export function availabilityFromText(s: string): StructuredProduct['availability'] {
  if (/אזל|לא במלאי|out\s*of\s*stock|sold\s*out/i.test(s)) return 'out_of_stock';
  if (/במלאי|הוסף לסל|add to cart|in\s*stock/i.test(s)) return 'in_stock';
  return 'unknown';
}

/* schema.org availability URL/enum to our three-value shape. */
function availabilityFromSchema(value: unknown): StructuredProduct['availability'] {
  const s = String(value ?? '');
  if (/OutOfStock|SoldOut|Discontinued/i.test(s)) return 'out_of_stock';
  if (/InStock|InStoreOnly|PreOrder|BackOrder|LimitedAvailability/i.test(s)) return 'in_stock';
  return 'unknown';
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

// --- 1. JSON-LD -------------------------------------------------------------

const JSONLD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/*
 * Flatten every shape schema.org allows a document to take: a bare object, an
 * array of them, `@graph`, and `ItemList.itemListElement` (whose entries are
 * usually `ListItem` wrappers around the real thing). Missing any of these was
 * the difference between reading a shop's whole grid and reading none of it.
 */
function flattenLd(node: unknown, out: any[] = []): any[] {
  if (Array.isArray(node)) {
    for (const n of node) flattenLd(n, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const obj = node as Record<string, unknown>;
  out.push(obj);
  if (obj['@graph']) flattenLd(obj['@graph'], out);
  if (obj.itemListElement) flattenLd(obj.itemListElement, out);
  if (obj.item) flattenLd(obj.item, out);
  return out;
}

function ldTypes(obj: any): string[] {
  const t = obj?.['@type'];
  return (Array.isArray(t) ? t : [t]).filter(Boolean).map(String);
}

/* Every offer an entity carries, in any of the shapes schema.org allows. */
function offersOf(obj: any): any[] {
  const raw = obj?.offers;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: any[] = [];
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    out.push(o);
    // AggregateOffer states a range; its low price is the one a shopper sees.
    if (o.offers) out.push(...(Array.isArray(o.offers) ? o.offers : [o.offers]));
  }
  return out;
}

export function parseJsonLdProducts(html: string, baseUrl = ''): StructuredProduct[] {
  const out: StructuredProduct[] = [];
  for (const match of html.matchAll(JSONLD_RE)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue; // one malformed block must not cost us the others
    }
    for (const entity of flattenLd(parsed)) {
      if (!ldTypes(entity).some((t) => /^(Product|ProductGroup|IndividualProduct)$/i.test(t))) {
        continue;
      }
      const name = String(entity.name ?? '').trim();
      if (!name) continue;
      for (const offer of offersOf(entity)) {
        const price =
          parsePriceNumber(offer.price) ??
          parsePriceNumber(offer.lowPrice) ??
          parsePriceNumber(offer.priceSpecification?.price);
        if (price === null) continue;
        out.push({
          name,
          price,
          currency: String(
            offer.priceCurrency ?? offer.priceSpecification?.priceCurrency ?? ''
          ).toUpperCase(),
          availability: availabilityFromSchema(offer.availability),
          url: absolute(String(offer.url ?? entity.url ?? ''), baseUrl),
          source: 'jsonld',
        });
        break; // one price per product: the first offer is the headline one
      }
    }
  }
  return out;
}

// --- 2. microdata -----------------------------------------------------------

/*
 * itemprop="price" inside an itemscope. The value may be on a `content`
 * attribute (the correct form) or in the element's text (common in the wild),
 * so both are read. The product name is the nearest enclosing itemscope's
 * itemprop="name".
 */
export function parseMicrodataProducts(html: string, baseUrl = ''): StructuredProduct[] {
  const doc = parse(html);
  const out: StructuredProduct[] = [];

  const visitScope = (scope: Node): void => {
    let name = '';
    let priceText = '';
    let currency = '';
    let availability: StructuredProduct['availability'] = 'unknown';
    let url = '';

    walk(scope, (n) => {
      if (!isElement(n)) return;
      // A nested product scope is its own product; leave it to its own visit.
      if (n !== scope && attr(n, 'itemscope') !== '' && /Product/i.test(attr(n, 'itemtype'))) {
        return false;
      }
      const prop = attr(n, 'itemprop');
      if (!prop) return;
      const value = attr(n, 'content') || textOf(n);
      if (prop === 'name' && !name) name = value;
      else if (prop === 'price' && !priceText) priceText = value;
      else if (prop === 'priceCurrency' && !currency) currency = value;
      else if (prop === 'availability') availability = availabilityFromSchema(attr(n, 'href') || value);
      else if (prop === 'url' && !url) url = attr(n, 'href') || value;
    });

    const price = parsePriceNumber(priceText);
    if (!name || price === null) return;
    out.push({
      name: name.trim(),
      price,
      currency: currency.toUpperCase(),
      availability,
      url: absolute(url, baseUrl),
      source: 'microdata',
    });
  };

  walk(doc, (n) => {
    if (isElement(n) && attr(n, 'itemscope') !== undefined && /Product/i.test(attr(n, 'itemtype'))) {
      visitScope(n);
    }
  });
  return out;
}

// --- 3. meta tags -----------------------------------------------------------

const META_PRICE_RE =
  /<meta[^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([^"']+)["']/i;
const META_PRICE_REV_RE =
  /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["']/i;
const META_CURRENCY_RE =
  /<meta[^>]+(?:property|name)=["'](?:og:price:currency|product:price:currency)["'][^>]+content=["']([^"']+)["']/i;
const META_TITLE_RE =
  /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i;
const META_URL_RE = /<meta[^>]+(?:property|name)=["']og:url["'][^>]+content=["']([^"']+)["']/i;

/*
 * og/product meta describe ONE product, so this only speaks for a product page.
 * On a search page the same tags describe the shop, which is why the caller
 * must not treat a meta hit as a catalogue.
 */
export function parseMetaProduct(html: string, baseUrl = ''): StructuredProduct | null {
  const priceMatch = html.match(META_PRICE_RE) ?? html.match(META_PRICE_REV_RE);
  const price = parsePriceNumber(priceMatch?.[1]);
  if (price === null) return null;
  const name = (html.match(META_TITLE_RE)?.[1] ?? '').trim();
  if (!name) return null;
  return {
    name,
    price,
    currency: (html.match(META_CURRENCY_RE)?.[1] ?? '').toUpperCase(),
    availability: availabilityFromText(html),
    url: absolute(html.match(META_URL_RE)?.[1] ?? '', baseUrl),
    source: 'meta',
  };
}

// --- 4. product cards -------------------------------------------------------

/*
 * The product grid itself. Every platform in the captured set renders one
 * container per product, and the container is the pairing evidence: a name and
 * a price inside the same card provably belong together, which is exactly the
 * fact markdown conversion destroys.
 *
 * Detection works UPWARD from the price, not downward from a product link, and
 * that choice is load-bearing. The obvious design - find product permalinks,
 * look inside for a price - needs to know what a product URL looks like, and
 * the existing PRODUCT_LINK_RE whitelist (`/product/`, `/products/`,
 * `/product-page/`, ...) is wrong for real shops: al-haderech.co.il links its
 * products at `/items/{slug}`, so a whitelist reads its entire grid as zero
 * products. A price with a currency symbol, by contrast, is unambiguous
 * wherever it appears, and every card has one.
 */

/* WooCommerce and Shopify both mark the current price with a class containing
 * "price"/"amount"/"money". `ins` is the sale price, `del` the struck-through
 * original - which must never win. */
const PRICE_CLASS_RE = /(^|[\s_-])(price|amount|money)([\s_-]|$)/i;

/*
 * Chrome that states a price but is not a product: the mini-cart, a price
 * filter slider, the site header. Checked per class TOKEN, never as a substring
 * of the whole class attribute - WooCommerce cards carry class soup like
 * `product type-product ... shipping-taxable purchasable`, and a substring test
 * for "shipping" threw away every card on h-shtilshop.co.il. A token may be
 * matched by prefix (`cart-total`) but never mid-word.
 */
const CHROME_TOKENS =
  /^(cart|minicart|mini-cart|checkout|basket|widget|sidebar|filter|slider|footer|header|nav|navbar|menu|breadcrumb|screen-reader-text|site-header|price_slider)(-|_|$)/i;

function isChrome(node: Node): boolean {
  const tokens = `${attr(node, 'class')} ${attr(node, 'id')}`.split(/[\s]+/).filter(Boolean);
  return tokens.some((t) => CHROME_TOKENS.test(t));
}

/* How far above a price we will look for its card before giving up. Measured:
 * the deepest real card in the fixtures needs 5. Past ~8 we would be selecting
 * the grid, which pairs one product's name with another's price. */
const MAX_CARD_CLIMB = 8;

function tagOf(node: Node): string {
  return isElement(node) ? defaultTreeAdapter.getTagName(node) : '';
}

/*
 * Text of a price container, with the parts that state a DIFFERENT price
 * removed: `del` is the struck-through pre-sale price, and `screen-reader-text`
 * is WooCommerce's spoken duplicate ("the original price was ...", "the current
 * price is ..."). Both sit inside the same `span.price` as the real price, so
 * reading the container's raw text mixes three numbers together.
 */
function priceText(node: Node): string {
  if (defaultTreeAdapter.isTextNode(node)) return node.value;
  const tag = tagOf(node);
  if (tag === 'del' || tag === 'script' || tag === 'style') return '';
  if (isElement(node) && /(^|\s)screen-reader-text(\s|$)/.test(attr(node, 'class'))) return '';
  let out = '';
  for (const child of children(node)) out += priceText(child);
  return out.replace(/\s+/g, ' ').trim();
}

/* First descendant matching a predicate, depth-first. */
function firstIn(node: Node, pred: (n: Node) => boolean): Node | null {
  let found: Node | null = null;
  walk(node, (n) => {
    if (found) return false;
    if (isElement(n) && pred(n)) found = n;
  });
  return found;
}

/*
 * The price a shopper actually pays, from a price container. An `<ins>`
 * descendant is the sale price and always wins - it is what the shop is
 * charging, and it appears AFTER the struck-through original in the DOM, so
 * any "first price found" rule quotes the wrong, higher number.
 */
function priceOf(node: Node): number | null {
  const sale = firstIn(node, (n) => tagOf(n) === 'ins');
  const text = priceText(sale ?? node);
  if (!hasCurrency(text)) return null;
  return parsePriceNumber(text);
}

/*
 * Every node that states a price a shopper would pay. Nodes inside `del` are
 * skipped: on a discounted product the pre-sale price appears FIRST in the DOM,
 * so reading the first price quoted the higher, wrong number.
 */
function priceNodes(doc: Node): Node[] {
  const out: Node[] = [];
  const visit = (node: Node, insideDel: boolean): void => {
    for (const child of children(node)) {
      if (!isElement(child)) continue;
      const tag = tagOf(child);
      if (tag === 'script' || tag === 'style' || tag === 'head') continue;
      const del = insideDel || tag === 'del';
      const priceish = hasClass(child, PRICE_CLASS_RE) || tag === 'ins';
      if (!del && priceish && priceOf(child) !== null) {
        out.push(child);
        continue; // the innermost wrapper is enough; do not re-add its children
      }
      visit(child, del);
    }
  };
  visit(doc, false);
  return out;
}

/* Links that are site plumbing, never a product. */
const UTILITY_HREF_RE =
  /\/(?:cart|checkout|my-account|account|login|logout|register|wishlist|compare|contact|search)\b|^(?:tel|mailto|javascript):|^#/i;

/*
 * How many distinct links a container may hold and still be one product card.
 * Real cards hold the photo link, the title link and maybe an add-to-cart, all
 * to the same product. A container with more links than this is a section of
 * the page, and pairing a price with a link from it pairs unrelated things -
 * which is how a free-shipping notice ("from ₪500") got attached to the cart
 * link and reported as a ₪500 product.
 */
const MAX_CARD_LINKS = 8;

/* Anchors directly under a node that carry an href and real link text. */
function titleLinkIn(node: Node): Node | null {
  let best: Node | null = null;
  let links = 0;
  walk(node, (n) => {
    if (!isElement(n) || tagOf(n) !== 'a') return;
    const href = attr(n, 'href');
    if (!href) return;
    links++;
    if (best || UTILITY_HREF_RE.test(href)) return;
    // Text, a heading, or an accessible name - an image-only link is the photo
    // link that sits above the title and tells us nothing.
    const text = textOf(n) || attr(n, 'title') || attr(n, 'aria-label');
    if (text.trim().length > 1) best = n;
  });
  return links > MAX_CARD_LINKS ? null : best;
}

/* First heading text under a node, which themes use for the product title. */
function headingIn(node: Node): string {
  let heading = '';
  walk(node, (n) => {
    if (heading || !isElement(n)) return;
    if (/^h[1-6]$/.test(tagOf(n))) heading = textOf(n);
  });
  return heading;
}

export function parseProductCards(html: string, baseUrl = ''): StructuredProduct[] {
  const doc = parse(html);
  const out: StructuredProduct[] = [];
  const claimed = new Set<string>();

  for (const priceNode of priceNodes(doc)) {
    const price = priceOf(priceNode);
    if (price === null) continue;

    /*
     * Climb to the lowest ancestor that also holds a titled link. The LOWEST
     * one is the card: stopping higher would swallow the next product too and
     * pair this price with that product's name.
     */
    let card: Node | null = null;
    let link: Node | null = null;
    let node: Node = priceNode.parentNode;
    let chrome = false;
    for (let i = 0; i < MAX_CARD_CLIMB && node; i++) {
      if (isChrome(node)) {
        chrome = true;
        break;
      }
      const found = titleLinkIn(node);
      if (found) {
        card = node;
        link = found;
        break;
      }
      node = node.parentNode;
    }
    if (chrome || !card || !link) continue;

    const href = attr(link, 'href');
    if (claimed.has(href)) continue;

    const name = (headingIn(card) || textOf(link) || attr(link, 'title') || attr(link, 'aria-label'))
      .trim();
    if (!name) continue;

    claimed.add(href);
    out.push({
      name,
      price,
      currency: 'ILS',
      availability: availabilityFromText(textOf(card)),
      url: absolute(href, baseUrl),
      source: 'card',
    });
  }

  return out;
}

// --- the union --------------------------------------------------------------

/*
 * De-dupe across readers. The same product can legitimately appear in JSON-LD
 * and in the grid; the earlier (more authoritative) source wins, and identity
 * is the product URL when there is one, else the name.
 */
function dedupe(products: StructuredProduct[]): StructuredProduct[] {
  const seen = new Set<string>();
  const out: StructuredProduct[] = [];
  for (const p of products) {
    const key = (p.url || p.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/*
 * Every product the page states in machine-readable form, best source first.
 *
 * `meta` is included only when nothing richer was found: it describes a single
 * product page, and on a search page those tags describe the shop, so promoting
 * it above a real catalogue would replace many right answers with one wrong one.
 */
export function extractStructuredProducts(html: string, baseUrl = ''): StructuredProduct[] {
  if (!html) return [];
  const ld = parseJsonLdProducts(html, baseUrl);
  const micro = parseMicrodataProducts(html, baseUrl);
  const cards = parseProductCards(html, baseUrl);
  const found = dedupe([...ld, ...micro, ...cards]);
  if (found.length > 0) return found;
  const meta = parseMetaProduct(html, baseUrl);
  return meta ? [meta] : [];
}

/* Render a structured price the way the rest of the pipeline writes prices. */
export function formatPrice(p: StructuredProduct): string {
  const n = Number.isInteger(p.price) ? String(p.price) : p.price.toFixed(2);
  return `₪${n}`;
}
