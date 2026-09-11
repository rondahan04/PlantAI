# Plan: dramatically increase scrape accuracy

Written 2026-09-07. Symptom from Ron: *"some scrapes, even when the product is
typed right and the page is found on the site, don't manage to scrape the
price."* The app's whole value is the scrape, so a found page with no price is
the worst failure we have - it looks like the shop doesn't sell the plant.

Everything below is grounded in the current code, with file:line.

---

## SUPERSEDED, 2026-09-07 evening: the price was never the problem

This document's phases 0 and 1 shipped and its metric reads **100%**, and the
product was still broken. That contradiction is the finding.

`scripts/price-accuracy.ts` grades **price parsing of pages we already
fetched**, for two easy queries. The failure Ron was describing happens one step
earlier, in **retrieval**: asking al-haderech for `אלוקסיה ריגל שילד` returned a
page with *no results at all*, so there were no prices to misread and nothing
looked wrong anywhere.

Measured live across all 16 hosts in `scraper/known-hosts.json`:

| query sent to the 9 WooCommerce shops | shops returning a real grid |
|---|---|
| `אלוקסיה ריגל שילד` (what we sent) | **1 of 9** |
| `אלוקסיה` (the genus alone) | **5 of 9** |

WordPress `?s=` and the Woo Store API both AND every word. The shops were not
missing the plant; we were asking a question their search engines cannot answer.

Three more root causes, all verified rather than inferred:

- **10 of 16 shops publish a free JSON product API** we were not using - the Woo
  Store API (8 hosts) and Shopify `/products.json` (3). They return the exact
  sale price, the stock flag and the product URL, with no LLM and no Firecrawl.
  decogarden's catalogue contains `אלוקסיה ריגל שילד 10 ליטר` - the exact plant.
- **Shopify HTML search ignores the query** on these themes (identical byte and
  currency-token counts across completely different searches), so the extractor
  saw whole catalogues and the 18000-char cap truncated them before the match.
- **A wrong cached platform was permanent.** `getzler.co.il` and
  `peer-nursery.co.il` were remembered as Shopify while serving WordPress; their
  search URLs 404ed on every search for a month. `forgetHost` only fired when
  *both* markdown and HTML were empty, and a 404 page is a large, readable body.
  `peer-nursery` is in fact a WooCommerce shop whose Store API answers fine.

And the reason nobody could see any of it: a retrieval miss became `no_match` →
`not_sold` → **hidden from the UI** by `isWorthShowing` (`src/lib/availability.ts`).
"We never managed to ask this shop" and "this shop does not stock it" rendered
identically, as nothing at all.

**The work that followed is in `RETRIEVAL.md`.** Phases 0-1 below remain correct
and are still in the code; they were simply solving a smaller problem than the
one that was hurting.

---

## Status: Phases 0 and 1 are DONE (2026-09-07)

Measured on 28 hand-labelled real nursery pages (`scraper/fixtures/`):

| | before | after |
|---|---|---|
| pages showing products that we read | not measurable | **15/15 (100%)** |
| pages showing none we correctly report empty | not measurable | **13/13 (100%)** |
| hand-verified name+price pairs exact | not measurable | **4/4 (100%)** |

Run it yourself: `npx tsx scripts/price-accuracy.ts` (offline, free).

**Three assumptions in the original plan turned out to be wrong**, and the
fixtures are what caught them:

1. **JSON-LD does not carry us.** Phase 1 assumed `Product.offers` would be on
   the page. It is not: we scrape SEARCH pages, and Product JSON-LD lives on
   PRODUCT pages. All 26 captured search pages emit only `CollectionPage` /
   `Organization`. The parser is still there and still correct - it just fires
   almost never on the pages we actually read. What works is reading the grid's
   own DOM, where a card provably pairs one name with one price.
2. **`rawHtml` from Firecrawl would have missed most sites.** Tavily, not
   Firecrawl, is the primary reader for every server-rendered shop
   (`tavilyLeads`, `core.ts:486`) and returns markdown only. The fix is a plain
   `fetch()` of the page (`fetchRawHtml`), which is free, unmetered, costs no
   Firecrawl slot, and works precisely where Tavily leads - because both mean
   "the HTML as served already contains the grid".
3. **The markdown path's problem is noise, not just loss.** On a page where the
   shop found nothing, `priceFocusedExcerpt` still hands the model an empty cart
   total (`₪0.00 עגלת קניות`) and a free-shipping threshold. Root cause 3 in the
   list below is real, but it is fed by garbage as much as by silence.

Two bugs found and fixed along the way that were costing real accuracy:

- **Wrong prices on sale items.** A WooCommerce sale block holds the
  struck-through original, a screen-reader duplicate of it, and the real price
  in one container. Stripping non-digits produced `699.00699` for a plant sold
  at ₪499.90 - a confidently wrong number that appears nowhere on the page.
- **`/items/` products were invisible.** `PRODUCT_LINK_RE` (`core.ts:865`)
  whitelists `/product/`, `/products/`, `/product-page/`. al-haderech.co.il
  links products at `/items/{slug}`, so its entire 28-product grid read as zero.
  Card detection now climbs from the price rather than trusting URL shape.
  **The excerpt filter still has this bug** - see Phase 3.

---

## Why prices go missing today

The pipeline is `fetch → priceFocusedExcerpt → LLM extract → LLM audit → price
sanity` (`scraper/core.ts:17`). Four structural weaknesses, in the order they
cost us accuracy:

### 1. We throw away the machine-readable price before we ever look

`scraper/core.ts:357` requests `formats: ['markdown']` with
`onlyMainContent: true`. Firecrawl returns markdown, so **every** structured
signal is discarded server-side before we see a byte:

- JSON-LD `<script type="application/ld+json">` with `Product.offers.price` -
  emitted by default on Shopify, WooCommerce and most Wix stores
- microdata `itemprop="price"`
- `<meta property="og:price:amount">` / `product:price:amount`

These are exact, free, and need no model. We are asking an LLM to re-read a
number the page already stated in a machine-readable field we deleted.

This is almost certainly the single biggest win available.

### 2. The excerpt filter is line-based, and prices often live on their own line

`priceFocusedExcerpt` (`scraper/core.ts:890`) keeps a line only if it is a
heading, matches `ILS_PRICE_RE`, or matches `PRODUCT_LINK_RE`. Two failure
modes follow directly:

- **Split currency.** Markdown frequently renders the symbol and the number as
  separate lines (`₪` from one span, `49.90` from the next). A lone `₪` has no
  adjacent digit and a lone `49.90` has no currency token, so `ILS_PRICE_RE`
  (`core.ts:874`) rejects **both**. The price is deleted from the excerpt and
  the model never sees it.
- **No adjacency guarantee.** Surviving lines are joined with everything
  between them removed, so on a 50-product grid the model must pair name to
  price across a stream where the pairing evidence (DOM proximity) is gone.
  Mis-pairing is silent and looks like a confident wrong price.

Also worth noting: `ILS_PRICE_RE` never matches a bare number, so a site that
prints `מחיר: 49.90` with the currency in a sibling element is priceless to us.

### 3. The prompt drops any product whose price we failed to see

`core.ts:1058`: *"Only REAL products that have a price."* Correct as written,
but combined with (1) and (2) it converts an extraction failure into a
**missing shop**. The user sees "not found" rather than "found, price unknown",
which is a different and much worse claim.

### 4. The failure taxonomy cannot express this bug

`ExtractStage = 'no_markdown' | 'no_excerpt' | 'no_match' | 'rejected' | 'ok'`
(`core.ts:1008`). "Found the product, could not read its price" has no stage of
its own - it lands in `no_match` or as a silently dropped row. So the exact
failure Ron is reporting is, today, **unmeasurable**.

---

## The plan

Ordered so that each phase is independently shippable and the first one tells
us whether the rest is working.

### Phase 0 - Measure before changing anything (DONE)

Without a number, "dramatically better" is unfalsifiable.

- Build a golden set: 20-30 real product URLs across the nurseries we actually
  hit, each with its true price recorded by hand. Include the ones Ron has seen
  fail.
- Save the fetched HTML/markdown as **fixtures** in the repo so the suite runs
  under `node --test` with no network and no spend. Note `cache.enabled:false`
  on Render (Trello #81) means live runs are billed scrapes - fixtures are not
  optional.
- Report one metric: **price accuracy = correct price / pages where a human can
  see a price**. Baseline it before touching anything.

Delivered: `scraper/fixtures/` (26 pages, gzipped, 2MB), `scraper/fixtures.ts`
(reader), `scripts/capture-price-fixtures.ts` (capture),
`scripts/label-price-fixtures.ts` (hand-written ground truth),
`scripts/price-accuracy.ts` (the metric).

The labels are hand-written and deliberately NOT derived from the extractor,
otherwise the metric would grade the extractor against itself. `pricedProducts:
0` means the shop showed no products for that search - a correct answer, not a
miss - which matters because 13 of the 28 pages are that case.

### Phase 1 - Read the structured data (DONE, biggest single win)

- `scraper/structuredPrice.ts`, pure and network-free, four readers: JSON-LD
  (`@graph`, arrays, `ItemList`, `AggregateOffer`), microdata, og/product meta,
  and **product cards** - the reader that actually carries the weight.
- `fetchRawHtml` (`core.ts`) reads the page as served, in parallel with the
  provider scrape so it adds no latency to the fan-out. Free, no Firecrawl slot.
- `html` threads through `SearchResult` → `scrapeOne` → `extractAndVerifyPlants`.
- Structured data becomes the model's input via `structuredCatalog`: one product
  per line, name and price already paired by the shop's own DOM. The LLM's job
  narrows to *which products match the query*, a language judgement it is good
  at. `snapPricesToStructured` then forces every returned price back to the
  parsed one, so a transcription slip cannot reach the user.
- The markdown excerpt remains the fallback for JS-rendered shops.

Measured effect on al-haderech (live, end to end): 28 products, exact sale
prices, and the model's input fell from the 18KB cap to 5.5KB - so this is
cheaper per call as well as more accurate.

### Phase 2 - Platform-native endpoints

`detectPlatform` already identifies shopify/woo/wix (`core.ts:543`) and we
already keep per-host platform caches. Use it for prices, not just for search
URLs:

- **Shopify**: `{product_url}.json` and `/products.json?limit=250` return exact
  price, title, availability and variants as JSON.
- **Woo**: Store API `/wp-json/wc/store/v1/products?search={q}` likewise.
- **Wix**: no public endpoint; rely on Phase 1 JSON-LD.

One cheap request replaces a scrape **and** an LLM call, and gives variant-level
prices we cannot currently see at all.

### Phase 3 - Fix the excerpt for everything still on the LLM path

- Replace line filtering with **block windows**: keep a product-ish anchor line
  plus N lines of context either side, so name and price stay adjacent.
- Join a lone currency line to the adjacent number before filtering.
- Extend `ILS_PRICE_RE` to bare decimal/comma forms when a currency token
  appears anywhere in the same block.
- Feed the model the price block, not the whole page.

### Phase 4 - Make the failure visible

- Add a `price_missing` stage to `ExtractStage` and stop silently dropping rows
  that have a product but no price.
- Surface "listed, price not stated" to the user (the "Listed · stock not
  stated" badge already establishes this pattern) instead of hiding the shop.
- Log per-host extraction stages so a site that regresses is visible in
  `scrapeHealth` rather than discovered by Ron.

---

## Sequencing and risk

- Phases 0 and 1 together should move the number most; do not start Phase 3
  before Phase 0 exists, or we will be tuning regexes blind.
- Phase 1 changes the Firecrawl request shape - `rawHtml` makes responses much
  larger, so check the effect on the scrape budget and the 12MB body cap.
- Phase 2 adds direct requests to nursery origins outside Firecrawl. Keep them
  inside the existing rate limiter and respect robots; these are ordinary
  public product endpoints, not a bypass.
- None of this touches the diagnosis path.

## Answered

1. **Show "listed, price not stated"?** Yes - but only after asking the model
   whether a missing price is plausible for that page, rather than showing it
   unconditionally. Phase 4 work.
2. **Which nursery failed?** Not needed in the end: the golden set surfaced the
   failures directly (al-haderech's `/items/` grid and its sale prices).

## Found while doing Phases 0-1, not yet fixed

- **`azurflowers.co.il` ignores the search query.** Its search URL returns the
  entire 500+ product catalogue whatever we ask for, both for `מונסטרה` and
  `פותוס`. We then pay to read and reason over all of it. Needs a real search
  URL for that host.
- **`getzler.co.il` and `peer-nursery.co.il` are cached as `shopify` but are
  not.** The remembered platform builds `/search?q=`, which 404s, so both shops
  return nothing on every search for up to 30 days (`HOST_PLATFORM_TTL_MS`).
  `forgetHost` only fires when a read returns nothing at all, and a 404 page is
  not nothing.
- **`peer-nursery.co.il` is still a lorem-ipsum placeholder site.** Nothing to
  scrape there at all; it should probably not be in the host list.
- **`PRODUCT_LINK_RE` misses `/items/`** (`core.ts:865`), which still costs the
  markdown fallback path. Phase 3.
