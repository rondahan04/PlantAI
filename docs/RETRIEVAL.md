# Retrieval: asking each shop a question it can answer

Written 2026-09-07, after `SCRAPE-ACCURACY-PLAN.md` shipped, reported 100%, and
the product was still broken. Read that document's "SUPERSEDED" section first -
it has the evidence. This one is what was built.

## The one-line version

**Send the genus, rank the shelf locally, and read the price from the shop's own
JSON.** The old pipeline sent the whole plant name to search engines that AND
every word, and asked a language model to read prices off a rendered page.

## What runs now

```
planQuery(name)                 one LLM call: Hebrew, Latin, and the other names
   │                            Israeli shops file this plant under
   ▼
fetchSearchMarkdown(site, plan)
   ├── the shop's storefront JSON, if it has one     ← 10 of 16 known shops
   │     woo:     /wp-json/wc/store/v1/products?search=<genus>&per_page=100
   │     shopify: /products.json (whole catalogue, cached 6h, filtered by us)
   │   free, unmetered, zero Firecrawl requests
   └── otherwise the HTML search page, exactly as before
   ▼
rankCandidates(products, plan)  pure string work: genus required, cultivar
   │                            coverage scores, foreign cultivar words penalised
   ▼
 decisive?  ── yes ──▶  answer straight from the shop's JSON, NO model at all
   │
   no ──▶ the top 20 candidates go to the existing extract+audit passes
```

## Why each piece exists

**The ladder starts broad** (`scraper/queryPlan.ts`, `ladderTerms`). A shop's
search is good at "show me the Alocasia shelf" and bad at "show me this exact
cultivar". We are the opposite, because we can compare every candidate at once.
It costs the same one request it always did.

**Ranking is arithmetic, not a distance metric** (`scoreCandidate`). The failure
mode of a broad query is confidently offering the wrong cultivar - a Zebrina for
a Regal Shield - and edit distance makes those two look similar. Token coverage
plus a penalty for cultivar words we never asked for makes them look as
different as they are. That penalty is the whole defence, and
`scraper/queryPlan.test.ts` tests it harder than it tests the happy path.

**Alternate names are searched AND ranked** (`altNames` / `altTokens`). Some
shops use the established Hebrew name rather than a transliteration -
h-shtilshop files Ficus lyrata as `פיקוס כינורי` - and no folding rule will ever
turn `ליראטה` into `כינורי`. Without this the ladder found the product and the
ranker then threw it away.

**The JSON routes buy budget, not just accuracy.** Firecrawl allows ten requests
a minute across the whole process. Every shop served from its own API costs zero
of them, which is what leaves the window for the shops that genuinely need a
browser.

**A wrong platform now heals itself** (`fetchRawHtmlResult`, `resolveApiRoute`).
The HTTP status is kept rather than discarded, so a 404 from a URL we built out
of a remembered platform forgets that platform; and a route inferred from the
platform that then returns nothing re-probes the shop instead of falling back to
a scrape. Measured on peer-nursery: 23s → 4.4s, and `known-hosts.json` corrected
itself from `shopify` to `woo` on the way past.

**The relevance guard applies to BOTH routes.** Ranking was originally wired
into the JSON route only, because that is where the broad query was introduced -
but the broad term goes to the HTML route too, where the model picks unguarded.
A live search for Alocasia Regal Shield came back from dizi-garden as
`אלוקסיה וונטי` at ₪60, a different plant. The model's answer now passes through
the same `scoreCandidate` bar, and anything below `WEAK_MATCH` is dropped with
the reason logged. Callers that pass a plain string rather than a plan get the
old, unguarded behaviour, so `dashboard/server.ts` is unaffected.

Worth noting how it was found: **the offline metric did not catch it.** Every
HTML-route shop in the fixture set is either unreadable or a genuine absence, so
the guard was never exercised on that path. It took a live search. The
regression is pinned in `core.test.ts` against the exact strings that failed.

**"Couldn't check this shop" is now distinct from "didn't find the product"**
(`src/lib/availability.ts`). The second claims we looked. Two nurseries spent a
month telling users their plants were unavailable when nobody had ever asked.

## The metric

`npm run retrieval:score` - offline, free, replays 318 captured shop responses.

```
retrieval  correct product retrieved where the shop lists it   ← the acceptance number
precision  of what we would show a user, how much is the plant
quiet      shops correctly reported as not stocking it
undecided  rows ranking could not settle - these cost an LLM call
```

Ground truth is judged by a model that reads **all** of a shop's product titles,
straight out of the captured JSON without passing through our own mapper, and is
asked a question about plants rather than about strings. Grading a string ranker
against string rules would report agreement as accuracy.

Current, on 156 hand-judged shop/plant pairs across 12 plants and 16 shops:

| | before (full phrase) | now |
|---|---|---|
| retrieval | 75% (18/24) | **100% (24/24)** |
| precision | - | **100%** |
| quiet | - | **100% (132/132)** |
| rows needing an LLM | - | 4 of 156 |

The "before" column is the control: same fixtures, same truth, same ranker, same
JSON routes, with only the query changed back to the full plant name. It
isolates the query change and understates the total gain, because the old
pipeline had no JSON routes at all. `scraper/retrieval.test.ts` asserts the
comparison, so a metric that stops being able to fail fails the build instead.

## Honest limits

- **24 listed pairs is a small denominator.** Most shop/plant pairs are genuine
  absences; the 100% is real but a single regression moves it four points.
- **The judge wobbles on borderline cultivars.** Asked whether
  `אלוקסיה ריגל שילד אלבו` is `Alocasia Regal Shield`, it has answered both ways
  across runs. Re-labelling can move a number without any code changing.
- **Truth is "listed at capture time".** Shops restock. `capturedAt` is stamped
  in the manifest; re-capture when a number moves for no reason you can name.
- **The metric does not exercise the HTML route's ranking.** Every HTML-route
  shop in the fixture set is unreadable or a genuine absence, so `precision` and
  `quiet` are effectively statements about the JSON routes. That blind spot is
  what let the dizi-garden wrong-cultivar bug ship. Capturing a plant that an
  HTML-only shop genuinely stocks would close it.
- **HTML-route labels are weaker.** For the JSON routes the judge sees the raw
  field; for HTML there is no independent reading short of a second parser, so
  those titles come from our own extractor.
- **6 shops still have no JSON route** (getzler, mashtela-urbanit, dizi-garden,
  vcactus, yifrach, and any new one Places finds). They ride the HTML+LLM path -
  but they get the broad term too, which is the change that turned 8-of-9
  no-results into real grids.

## Working on this

```
npm run retrieval:score            the metric (offline, free)
npm run retrieval:score -- --verbose   every row that is not a silent correct absence
npm run retrieval:capture          re-capture the shop responses (free: plain fetches)
npm run retrieval:label            re-judge ground truth (LLM, ~190 small calls)
npm test                           includes the acceptance gate
```

`RETRIEVAL_API=0` turns the JSON routes off and restores the old HTML+LLM path
without a deploy.

---

## 2026-09-15: the sixteen, and what they changed

A review of the whole scraper asked one question - raise the hit rate, or cut
the time, without trading one for the other - and produced sixteen changes.
They are listed here by what they were fixing, because the code comments carry
the mechanism and this is the map.

### Wrong answers we were giving

**The ladder stopped on the wrong signal** (`apiSearch`, `scraper/core.ts`). It
broke out of the term ladder as soon as the Store API returned ANY row, and
Woo's `search` matches a product's description as well as its title - so a shop
answering "פיקוס" with a bag of compost ended the ladder before the rung that
would have worked, and `catalogueRead` went out as true. The shop was then
reported as not stocking a plant nobody had asked it about in a word it knows.
It now stops on a RANKED row, and merges the rungs instead of replacing them.

**A Hebrew query got no plan at all.** `planQuery` returned early when the input
was already Hebrew - nothing to translate - which also meant no alternate names
and no Latin rung. That is the weakest search this code can make, and it is what
an Israeli user typing Hebrew was getting. The call is made now; the user's own
spelling stays `hebrew` verbatim and the model only adds rungs beside it.

**The Woo shelf was truncated at 100 and nobody said so.** `per_page` is capped
by the Store API, so a shop with more than 100 products matching the genus
answered with a full page and said nothing about the rest - the cultivar we were
sent for simply absent. `wooStoreSearch` pages while pages come back full, and a
shelf that stopped at the cap is no longer `complete`, so absence from it cannot
be read as absence from the shop.

**The final price check was asking about the wrong rows.** It filtered on
`inStockKnown`, which is a fact about STOCK: a listing whose page never stated
stock kept its price and skipped the check entirely. It now checks every priced
row - and only the ones a MODEL read, because a number copied out of a field
labelled `price` was never mistaken for a phone number.

### Shops we could not read at all

**The sitemap route** (`scraper/sitemapCatalogue.ts`). Six known nurseries have
no storefront JSON, and every new shop Places finds may be another. When their
own search is missing or broken - yahalomr.co.il 404s every query, others hand
back the front page - there was nothing to read and the shop was reported as
unreadable, while publishing a complete machine-readable list of its products at
a standard URL. robots.txt, then the well-known locations; slugs ranked against
the plan in either language; the best few opened and priced from their own
markup. Gated on the SEARCH having failed, never on it having found nothing, so
a shop that answered is never made to read out its sitemap.

**A product page is now readable on its own** (`parseProductPage`). The card
reader pairs a price with a titled link, because on a grid that link says which
product the price belongs to - and a product page does not link to itself. Both
rescues end at a product page, so a shop whose product pages carry no JSON-LD,
no microdata and no og:price was rescuing nothing.

**The excerpt lost prices it had been handed** (Phase 3 of
`SCRAPE-ACCURACY-PLAN.md`, finally shipped). A price split across two lines - `₪`
from one span, `49.90` from the next - was rejected by both halves and deleted.
`/items/` was missing from the product-link list, so al-haderech's entire grid
read as zero. And a bare price line lost its product's name when the name was
not a heading. All three are fixed, and the noise contract is unchanged: one
line back, only for a price with no words of its own.

**Discovery asked for one word.** Text Search treats "משתלה" and "חנות צמחים" as
unrelated strings, and the scrapable cap was 10 out of a 20-result page - priced
for a pipeline where every shop cost identification, a rendered scrape and two
model calls. Two terms now, 15 shops, and `pages` for a second page when a
caller wants one.

### Time the user was waiting through

**Identification ran before the free probe.** A host we had never met paid the
whole cascade - a homepage read, a rendered Firecrawl homepage at a 4s wait plus
two endpoint reads, then an LLM classification - before anyone asked the shop
its own catalogue endpoint. For a WooCommerce shop that cascade's entire output
is the word "woo", which `probeApiRoute` establishes with two plain GETs and
writes back. Every nursery Places discovers for a new user is such a host, so
this is the common path in production and the one the fixtures cannot see.

**The page route paid three model calls for rows it had already parsed.** When a
search page is server-rendered, the card reader has the grid: name, price and
URL, paired by the shop's own markup. Those rows were then handed to extraction,
verification AND adjudication - with the prices forced back afterwards by
`snapPricesToStructured`, because the model's copy of them was not trusted
anyway. The JSON route answers the same question with ranking and at most one
model call. The page route does now too, and falls through to the old path
untouched when ranking finds nothing.

**The same page was fetched twice to judge whether the shop had searched.**
`judgeAnswered` re-read a URL the caller was already holding, to learn a status
code the caller was also holding. And the control read - the same URL asked for
a plant nobody stocks - was re-fetched per search, though it says something
about the SHOP and not about the plant. It is passed the status now, cached per
shop for an hour, and started alongside the scrape rather than after it.

**The plan was re-derived on every search**, by a reasoning model, in series,
with the whole fan-out waiting on it. Cached per plant, in-flight-deduped, and
failures are deliberately not cached.

**The Shopify catalogue was 8 serial round trips**, on a cache a Render cold
start empties. Page 1 alone, then three at a time.

**One dead shop set the length of the whole search.** `SITE_BUDGET_MS` is a
ceiling per shop, so a search took as long as its slowest shop however quickly
the rest answered. Once 70% of the fan-out has settled the stragglers get
`NURSERY_TAIL_GRACE_MS` (10s) rather than the full 45. Both deadlines still
apply, and a shop cut off here reports exactly as it did before - unread, never
"not stocked".

**Prompts were ordered so that caching could never fire.** The extraction and
verification passes are handed the identical source text, up to 18KB of it,
against a few hundred bytes of instructions - and it was at the END of both, so
the two prompts shared no prefix. It leads now, and the audit pass starts from a
cached read of the same bytes. `reasoning_effort: 'low'` on the two narrow
classification calls (`judgeMatches`, `sanityCheckPrices`), verified against
their own hard cases first: 10/10 and 5/5 at both efforts, measurably faster at
low.

**The durable cache had the wrong grain.** `nursery_searches` keys on term +
point rounded to ~100m + radius, so it answers only when the same question is
asked from within a hundred metres of where it was asked before - GPS jitter
alone defeats it. `nursery_shop_results` keys on the shop and the plant, which
is the part of a search that does not depend on who is asking or from where. A
search pays only for the shops nobody has asked about lately. Only `found` and
`not_sold` are stored: `not_found` is a shop that was down, and caching it would
turn one bad minute into a day.

### Still true, and still the biggest number

`cache.enabled: false` in production. Both caches are no-ops without
`SUPABASE_SERVICE_ROLE_KEY`, and `/health` reports each separately.
