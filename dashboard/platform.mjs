/**
 * Platform-agnostic search URL resolution for nursery sites.
 *
 * The scraper must work on UNKNOWN sites (Google Maps feeds arbitrary nursery
 * URLs), so we cannot hardcode a per-host map. Instead we detect the store
 * platform from homepage markers and map it to that platform's product-search
 * URL. Unknown platforms fall back to probing a few candidate URLs and keeping
 * whichever returned the most product/price content.
 *
 * These are pure functions (no network) so they can be unit-tested directly —
 * see platform.test.mjs.
 *
 *   detectPlatform(md) ──▶ 'shopify' | 'woo' | 'wix' | 'unknown'
 *                               │
 *   searchUrlsFor(origin,q,p) ──┴─▶ ['…'] (1 url known) | ['…','…','…'] (probe)
 *                                          │
 *   scoreMarkdown(md,q) ◀── pick best probe result
 */

/*
 * Detect the e-commerce platform from homepage markdown.
 *
 * Marker notes (order matters — check Shopify before Woo):
 *   Shopify: /cdn/shop/, cdn.shopify, /collections/, /products/ (plural)
 *   Woo:     wp-content, woocommerce, /product/ (singular), /product-category/
 *   Wix:     wixstatic.com, _wix, wix.com
 * Shopify uses /products/ (plural) and Woo uses /product/ (singular), so the
 * `/product/` test below only matches Woo.
 */
export function detectPlatform(markdown) {
  const s = markdown || '';
  if (/\/cdn\/shop\/|cdn\.shopify|Shopify\.theme|\/collections\/|\/products\//.test(s)) return 'shopify';
  if (/wp-content|woocommerce|\/product-category\/|\/product\//.test(s)) return 'woo';
  if (/wixstatic\.com|_wix|wixsite|static\.wixstatic/.test(s)) return 'wix';
  return 'unknown';
}

/*
 * Build the product-search URL(s) for a site. Known platforms return exactly
 * one URL; unknown returns an ordered probe list (most-likely first) for the
 * caller to try in parallel and score.
 */
export function searchUrlsFor(origin, query, platform) {
  const q = encodeURIComponent(query);
  switch (platform) {
    case 'shopify':
      return [`${origin}/search?q=${q}`];
    case 'woo':
      return [`${origin}/?s=${q}&post_type=product`];
    case 'wix':
      // Wix Stores commonly expose /search; if that misses, the probe path
      // would catch it, but a single guess keeps the warm case to one fetch.
      return [`${origin}/search?q=${q}`];
    default:
      // unknown → probe. WooCommerce first (most common for IL nurseries),
      // then Shopify-style, then bare WordPress search.
      return [
        `${origin}/?s=${q}&post_type=product`,
        `${origin}/search?q=${q}`,
        `${origin}/?s=${q}`,
      ];
  }
}

/*
 * Score a scraped search-results page for the probe path. A real results page
 * has product permalinks + prices, and echoes the query term in its heading
 * ("results for X"). A site that ignored the search param returns its homepage,
 * which has prices/links too — so the query-echo bonus is what separates a true
 * results page from a homepage fallback.
 */
export function scoreMarkdown(markdown, query) {
  const s = markdown || '';
  const prices = (s.match(/₪/g) || []).length;
  const productLinks = (s.match(/\/products?\//g) || []).length;
  const queryEcho = query && s.includes(query) ? 50 : 0;
  return prices + productLinks + queryEcho;
}
