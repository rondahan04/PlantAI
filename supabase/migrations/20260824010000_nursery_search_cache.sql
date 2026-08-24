-- Shared nursery-scrape cache.
--
-- A scrape was measured at eight minutes and costs real money per run, so the
-- same question asked twice must not be paid for twice. The row is keyed by
-- what actually determines the answer - the search term, the point rounded to
-- ~100m, and the radius - which means one user's diagnosis warms the cache for
-- everyone nearby asking the same thing.
--
-- Deliberately NOT user-scoped: there is nothing personal in "which shops near
-- this point stock a Monstera", and scoping it per user would make every user
-- pay for the same scrape. Nothing here identifies who asked.

create table public.nursery_searches (
  -- "<query>|<lat>|<lng>|<radius_m>", built by server/nurseryCache.ts. The
  -- parts are stored alongside it for debugging and for expiry sweeps; the key
  -- is what lookups use, so a change to how it is built is a cache miss rather
  -- than a wrong answer.
  key text primary key,
  query text not null,
  lat numeric(8, 3) not null,
  lng numeric(8, 3) not null,
  radius_m integer not null,
  results jsonb not null,
  result_count integer not null,
  scraped_at timestamptz not null default now()
);

create index nursery_searches_scraped_at_idx on public.nursery_searches (scraped_at);

-- RLS on with NO policies: the anon and authenticated roles cannot read or
-- write this table at all. The API server reaches it with the service role,
-- which bypasses RLS - so the cache is reachable only through the same gated
-- endpoint that pays for the scrape, and the app cannot be used to enumerate
-- it. Freshness (the TTL) is enforced server-side, not here.
alter table public.nursery_searches enable row level security;
