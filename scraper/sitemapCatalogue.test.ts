/*
 * Tests for the sitemap route - the way into a shop whose own search does not
 * work. No network: every fetch is injected.
 *
 * The shapes below are the ones Israeli nurseries actually serve. A slug is
 * written three different ways in one country - Hebrew percent-encoded, a Latin
 * transliteration, and Joomla's `-detail` suffix - and ranking has to reach all
 * three, because a shop that files its plants in Latin is not a shop with no
 * plants.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSitemapCache,
  isProductUrl,
  locsIn,
  rankSitemapLinks,
  sitemapProductUrls,
  sitemapsInRobots,
  slugTitle,
} from './sitemapCatalogue.ts';
import { buildQueryPlan } from './queryPlan.ts';

const ORIGIN = 'https://yahalomr.co.il';

const urlset = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;

const index = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join('\n')}
</sitemapindex>`;

/* A shop answering from a table of paths; anything else 404s. */
function shop(routes: Record<string, string>, log?: string[]): any {
  return async (url: string) => {
    log?.push(url);
    const path = new URL(url).pathname;
    const body = routes[path];
    if (body === undefined) return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
    return { ok: true, status: 200, headers: new Headers(), text: async () => body };
  };
}

// --- reading -----------------------------------------------------------------

test('robots.txt is where the sitemap lives, and is asked first', async () => {
  clearSitemapCache();
  const log: string[] = [];
  const fetchImpl = shop(
    {
      '/robots.txt': 'User-agent: *\nDisallow: /wp-admin/\nSitemap: https://yahalomr.co.il/custom-sitemap.xml\n',
      '/custom-sitemap.xml': urlset([`${ORIGIN}/product/monstera-deliciosa/`]),
    },
    log
  );
  const out = await sitemapProductUrls(ORIGIN, { fetchImpl });
  assert.equal(log[0], `${ORIGIN}/robots.txt`);
  assert.deepEqual(out.urls, [`${ORIGIN}/product/monstera-deliciosa/`]);
  assert.equal(out.read, true);
});

test('a shop with no robots.txt is tried at the well-known locations', async () => {
  clearSitemapCache();
  const fetchImpl = shop({
    '/sitemap_index.xml': index([`${ORIGIN}/product-sitemap.xml`, `${ORIGIN}/post-sitemap.xml`]),
    '/product-sitemap.xml': urlset([`${ORIGIN}/product/ficus-lyrata/`]),
    '/post-sitemap.xml': urlset([`${ORIGIN}/blog/how-to-water/`]),
  });
  const out = await sitemapProductUrls(ORIGIN, { fetchImpl });
  assert.deepEqual(out.urls, [`${ORIGIN}/product/ficus-lyrata/`]);
});

/* An index also lists posts, pages, authors and category archives. Opening
 * those spends the budget on things that can never be a product. */
test('only the product sitemaps in an index are opened', async () => {
  clearSitemapCache();
  const log: string[] = [];
  const fetchImpl = shop(
    {
      '/sitemap_index.xml': index([
        `${ORIGIN}/post-sitemap.xml`,
        `${ORIGIN}/author-sitemap.xml`,
        `${ORIGIN}/product-sitemap.xml`,
      ]),
      '/product-sitemap.xml': urlset([`${ORIGIN}/product/alocasia/`]),
    },
    log
  );
  await sitemapProductUrls(ORIGIN, { fetchImpl });
  assert.ok(!log.some((u) => u.includes('author-sitemap')));
  assert.ok(!log.some((u) => u.includes('post-sitemap')));
});

test('another shop\'s URLs in our sitemap are not our products', async () => {
  clearSitemapCache();
  const fetchImpl = shop({
    '/sitemap.xml': urlset([
      `${ORIGIN}/product/monstera/`,
      'https://some-supplier.com/product/monstera/',
    ]),
  });
  const out = await sitemapProductUrls(ORIGIN, { fetchImpl });
  assert.deepEqual(out.urls, [`${ORIGIN}/product/monstera/`]);
});

test('a shop that publishes nothing readable says so, rather than reporting an empty catalogue', async () => {
  clearSitemapCache();
  const out = await sitemapProductUrls(ORIGIN, { fetchImpl: shop({}) });
  assert.equal(out.read, false);
  assert.deepEqual(out.urls, []);
});

test('a product list is read once per shop, not once per plant', async () => {
  clearSitemapCache();
  const log: string[] = [];
  const fetchImpl = shop({ '/sitemap.xml': urlset([`${ORIGIN}/product/monstera/`]) }, log);
  await sitemapProductUrls(ORIGIN, { fetchImpl });
  const first = log.length;
  await sitemapProductUrls(ORIGIN, { fetchImpl });
  assert.equal(log.length, first, 'the second plant reads the first plant\'s answer');
});

test('two plants racing into one cold shop share a single read', async () => {
  clearSitemapCache();
  let reads = 0;
  const fetchImpl = (async (url: string) => {
    reads += 1;
    await new Promise((r) => setTimeout(r, 5));
    const path = new URL(url).pathname;
    if (path === '/sitemap.xml') {
      return { ok: true, status: 200, headers: new Headers(), text: async () => urlset([`${ORIGIN}/product/monstera/`]) };
    }
    return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
  }) as any;
  await Promise.all([
    sitemapProductUrls(ORIGIN, { fetchImpl }),
    sitemapProductUrls(ORIGIN, { fetchImpl }),
  ]);
  /* robots.txt plus the well-known probes, once - not twice. */
  const once = reads;
  await Promise.all([
    sitemapProductUrls(ORIGIN, { fetchImpl }),
    sitemapProductUrls(ORIGIN, { fetchImpl }),
  ]);
  assert.equal(reads, once);
});

// --- what counts as a product ------------------------------------------------

test('a product URL is told apart from an archive that merely sits under one', () => {
  assert.equal(isProductUrl('https://x.co.il/product/monstera/'), true);
  assert.equal(isProductUrl('https://x.co.il/products/monstera'), true);
  assert.equal(isProductUrl('https://x.co.il/items/alocasia-regal/'), true);
  /* mashtela-urbanit's Joomla links every product this way. */
  assert.equal(isProductUrl('https://x.co.il/catalog/home-office/monstera-detail'), true);
  assert.equal(isProductUrl('https://x.co.il/product-category/indoor/'), false);
  assert.equal(isProductUrl('https://x.co.il/blog/how-to-water/'), false);
  assert.equal(isProductUrl('https://x.co.il/about-us/'), false);
});

test('locsIn reads a sitemap whatever namespace prefix it uses', () => {
  const xml = '<urlset><url><loc>https://a/1</loc></url><url><loc>\n https://a/2 \n</loc></url></urlset>';
  assert.deepEqual(locsIn(xml), ['https://a/1', 'https://a/2']);
  assert.deepEqual(locsIn('<loc>https://a/?a=1&amp;b=2</loc>'), ['https://a/?a=1&b=2']);
});

test('sitemapsInRobots finds every advertised sitemap, however it is cased', () => {
  const robots = 'User-agent: *\nSITEMAP: https://a/1.xml\nsitemap:   https://a/2.xml\n';
  assert.deepEqual(sitemapsInRobots(robots), ['https://a/1.xml', 'https://a/2.xml']);
});

// --- the slug is the only name a URL carries ---------------------------------

test('slugTitle reads the three ways an Israeli shop writes a slug', () => {
  /* Hebrew, percent-encoded. */
  assert.equal(
    slugTitle('https://x.co.il/product/%D7%9E%D7%95%D7%A0%D7%A1%D7%98%D7%A8%D7%94-%D7%93%D7%9C%D7%99%D7%A1%D7%99%D7%95%D7%A1%D7%94/'),
    'מונסטרה דליסיוסה'
  );
  /* A Latin transliteration. */
  assert.equal(slugTitle('https://x.co.il/product/monstera-deliciosa/'), 'monstera deliciosa');
  /* Joomla, with its suffix. */
  assert.equal(slugTitle('https://x.co.il/catalog/like-light/מונסטרה-detail'), 'מונסטרה');
});

test('a slug that names the plant is worth opening, in either language', () => {
  const plan = buildQueryPlan({
    original: 'Monstera deliciosa',
    hebrew: 'מונסטרה דליסיוסה',
    latin: 'Monstera deliciosa',
  });
  const links = rankSitemapLinks(
    [
      'https://x.co.il/product/compost-organic/',
      'https://x.co.il/product/monstera-deliciosa/',
      'https://x.co.il/product/%D7%9E%D7%95%D7%A0%D7%A1%D7%98%D7%A8%D7%94-%D7%93%D7%9C%D7%99%D7%A1%D7%99%D7%95%D7%A1%D7%94/',
    ],
    plan
  );
  assert.equal(links.length, 2, 'the compost is not a candidate');
  assert.ok(links.every((l) => /monstera|מונסטרה/i.test(l.name)));
});

/* The bar is the genus, as it is for a page's anchors: which cultivar it
 * actually is gets settled later, on a priced row, by the adjudicator. */
test('a cousin of the right genus is opened, and a different plant is not', () => {
  const plan = buildQueryPlan({
    original: 'Alocasia Regal Shield',
    hebrew: 'אלוקסיה ריגל שילד',
    latin: 'Alocasia Regal Shield',
  });
  const links = rankSitemapLinks(
    [
      'https://x.co.il/product/alocasia-zebrina/',
      'https://x.co.il/product/alocasia-regal-shield/',
      'https://x.co.il/product/ficus-lyrata/',
    ],
    plan
  );
  assert.equal(links[0].name, 'alocasia regal shield', 'the best slug leads');
  assert.ok(!links.some((l) => l.name.includes('ficus')));
});

test('a sitemap of numbered slugs names nothing, and nothing is opened', () => {
  const plan = buildQueryPlan({ original: 'Monstera', hebrew: 'מונסטרה', latin: 'Monstera' });
  assert.deepEqual(rankSitemapLinks(['https://x.co.il/product/12345/'], plan), []);
});

/*
 * A shop whose certificate has expired is exactly the kind whose search we
 * could not read either, which is most of what made this route worth having.
 */
test('a shop that outlived its certificate is read over http', async () => {
  clearSitemapCache();
  const tried: string[] = [];
  const fetchImpl = (async (url: string) => {
    tried.push(url);
    if (url.startsWith('https://')) throw new Error('ECONNRESET');
    const path = new URL(url).pathname;
    if (path === '/robots.txt') {
      return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
    }
    if (path === '/sitemap_index.xml') {
      return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
    }
    if (path === '/wp-sitemap.xml') {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => urlset([`${ORIGIN}/product/monstera/`]),
      };
    }
    return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
  }) as any;

  const out = await sitemapProductUrls(ORIGIN, { fetchImpl });
  assert.ok(tried.some((u) => u.startsWith('http://')), 'the insecure retry happened');
  assert.deepEqual(out.urls, [`${ORIGIN}/product/monstera/`]);
});

test('an http 404 is a real answer and is not asked again', async () => {
  clearSitemapCache();
  const tried: string[] = [];
  const fetchImpl = (async (url: string) => {
    tried.push(url);
    return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
  }) as any;
  await sitemapProductUrls('http://plain.co.il', { fetchImpl });
  assert.ok(tried.every((u) => u.startsWith('http://')));
});
