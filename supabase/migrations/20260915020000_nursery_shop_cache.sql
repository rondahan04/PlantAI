-- Per-SHOP nursery cache, beside the per-search one.
--
-- WHY A SECOND GRAIN. `nursery_searches` is keyed by the whole question -
-- term, point rounded to ~100m, radius - so it answers only when the same
-- person asks the same thing from within a hundred metres of where they asked
-- it last. GPS jitter alone defeats that: two users on the same street, or one
-- user who walked a block, produce different keys and pay for two identical
-- scrapes of the same dozen shops.
--
-- What is actually reusable is one level down. "Does al-haderech.co.il stock a
-- Monstera deliciosa, and for how much" has nothing to do with where the person
-- asking is standing, or how wide a radius they chose, or which other shops
-- came back alongside it. Keyed that way, a search pays only for the shops
-- nobody has asked about lately - and in a country where every user in Tel Aviv
-- discovers overlapping sets of the same nurseries, that is most of them.
--
-- The per-search table stays: when it hits, it answers the whole question in
-- one round trip. This one is what catches everything it misses.

create table public.nursery_shop_results (
  -- "<host>|<query>", built by server/nurseryCache.ts. Lowercased and trimmed
  -- on both halves, so "Monstera" and "monstera" are one row rather than two
  -- paid reads of the same shop.
  key text primary key,
  host text not null,
  query text not null,
  -- The scrape's verdict for this one shop: price, outcome, product URL and the
  -- rest of the row, minus the identity fields that come from Places per search
  -- (name, address, distance, phone, photo). Those are cheap and local; what is
  -- expensive is what this shop had on its shelf.
  result jsonb not null,
  -- Denormalised for sweeps and for reading the table by eye: which shops are
  -- answering, and which are only ever recorded as unreadable.
  outcome text,
  scraped_at timestamptz not null default now()
);

create index nursery_shop_results_scraped_at_idx on public.nursery_shop_results (scraped_at);
create index nursery_shop_results_host_idx on public.nursery_shop_results (host);

-- RLS on with NO policies, exactly as for nursery_searches: anon and
-- authenticated cannot touch this table, and the API server reaches it with the
-- service role, which bypasses RLS. Nothing here records who asked - a row says
-- what a public shop listed at a public price, and nothing about a person.
alter table public.nursery_shop_results enable row level security;
