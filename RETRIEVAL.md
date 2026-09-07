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
