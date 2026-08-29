/*
 * Everyday names for plants, applied to what the identifiers hand us.
 *
 * THE PROBLEM. Both identifiers answer in the register of their source.
 * PlantNet returns herbarium common names ("Sander's Alocasia"), and the vision
 * model returns whatever the botanical literature calls the plant ("Alocasia ×
 * amazonica", "Alocasia 'Polly'"). Neither is wrong and neither is what the
 * person holding the plant calls it - they bought an African mask plant. The
 * name is the first and largest thing on the diagnosis screen, so a name nobody
 * uses is the single most alienating word in the app.
 *
 * WHAT THIS IS NOT. It is not a translation of the identification and it never
 * changes WHICH plant we think we are looking at - `scientificName` is
 * untouched and still travels with every diagnosis. This renames, it does not
 * re-identify. A plant missing from the table keeps the name it arrived with,
 * so the table growing is always additive and never a behaviour change for
 * anything already in it.
 *
 * KEYED ON THE BINOMIAL, not on the common name we are replacing. Keying on the
 * name would mean listing every phrasing each identifier might produce -
 * "Sander's Alocasia", "Sanders alocasia", "Alocasia sanderiana" - and missing
 * one silently does nothing. The species is the stable identity underneath all
 * of them.
 */

/*
 * Species → the name a person would actually say. Genus keys are allowed and
 * act as a fallback for any species in that genus we have not listed, which is
 * what makes an unfamiliar Alocasia still read as an African mask plant rather
 * than as a binomial.
 *
 * Only add an entry where the everyday name is genuinely more common than what
 * the identifiers return. A "friendlier" name that is merely different trades a
 * precise name for a vague one and helps nobody.
 */
const COMMON_NAMES: Record<string, string> = {
  // Aroids - the bulk of what people photograph, and the worst offenders for
  // botanical-sounding names in the shops.
  'alocasia amazonica': 'African mask plant',
  'alocasia sanderiana': 'African mask plant',
  'alocasia zebrina': 'Zebra plant',
  'alocasia macrorrhizos': 'Giant taro',
  alocasia: 'African mask plant',
  'monstera deliciosa': 'Swiss cheese plant',
  'monstera adansonii': 'Swiss cheese vine',
  'rhaphidophora tetrasperma': 'Mini monstera',
  'epipremnum aureum': 'Pothos',
  'scindapsus pictus': 'Satin pothos',
  'zamioculcas zamiifolia': 'ZZ plant',
  'spathiphyllum wallisii': 'Peace lily',
  spathiphyllum: 'Peace lily',
  'syngonium podophyllum': 'Arrowhead plant',
  'philodendron hederaceum': 'Heartleaf philodendron',
  'philodendron bipinnatifidum': 'Tree philodendron',
  'anthurium andraeanum': 'Flamingo flower',
  'dieffenbachia seguine': 'Dumb cane',
  'aglaonema commutatum': 'Chinese evergreen',
  'colocasia esculenta': 'Elephant ear',
  'caladium bicolor': 'Angel wings',

  // Figs and other trees people keep indoors.
  'ficus lyrata': 'Fiddle leaf fig',
  'ficus elastica': 'Rubber plant',
  'ficus benjamina': 'Weeping fig',
  'ficus microcarpa': 'Ginseng ficus',
  'schefflera arboricola': 'Umbrella plant',
  'dracaena trifasciata': 'Snake plant',
  'sansevieria trifasciata': 'Snake plant',
  'dracaena fragrans': 'Corn plant',
  'dracaena marginata': 'Dragon tree',
  'yucca elephantipes': 'Spineless yucca',
  'pachira aquatica': 'Money tree',
  'crassula ovata': 'Jade plant',
  'beaucarnea recurvata': 'Ponytail palm',

  // Palms, ferns and the rest of the green furniture.
  'chamaedorea elegans': 'Parlour palm',
  'dypsis lutescens': 'Areca palm',
  'howea forsteriana': 'Kentia palm',
  'nephrolepis exaltata': 'Boston fern',
  'asplenium nidus': "Bird's nest fern",
  'platycerium bifurcatum': 'Staghorn fern',
  'adiantum raddianum': 'Maidenhair fern',
  'chlorophytum comosum': 'Spider plant',
  'tradescantia zebrina': 'Wandering dude',
  'hedera helix': 'English ivy',
  'maranta leuconeura': 'Prayer plant',
  'calathea orbifolia': 'Prayer plant',
  'goeppertia orbifolia': 'Prayer plant',
  'ctenanthe burle-marxii': 'Fishbone prayer plant',
  'fittonia albivenis': 'Nerve plant',
  'peperomia obtusifolia': 'Baby rubber plant',
  'pilea peperomioides': 'Chinese money plant',
  'soleirolia soleirolii': "Baby's tears",

  // Succulents and cacti.
  'aloe vera': 'Aloe vera',
  'aloe barbadensis': 'Aloe vera',
  'echeveria elegans': 'Mexican snowball',
  'haworthiopsis attenuata': 'Zebra haworthia',
  'haworthia attenuata': 'Zebra haworthia',
  'senecio rowleyanus': 'String of pearls',
  'curio rowleyanus': 'String of pearls',
  'ceropegia woodii': 'String of hearts',
  'schlumbergera truncata': 'Christmas cactus',
  'euphorbia trigona': 'African milk tree',
  'euphorbia tirucalli': 'Pencil cactus',
  'kalanchoe blossfeldiana': 'Flaming Katy',
  'sedum morganianum': "Burro's tail",
  'opuntia microdasys': 'Bunny ear cactus',

  // Flowering and everything else that shows up often.
  'phalaenopsis amabilis': 'Moth orchid',
  phalaenopsis: 'Moth orchid',
  'saintpaulia ionantha': 'African violet',
  'streptocarpus ionanthus': 'African violet',
  'begonia maculata': 'Polka dot begonia',
  'hoya carnosa': 'Wax plant',
  'strelitzia nicolai': 'Giant white bird of paradise',
  'strelitzia reginae': 'Bird of paradise',
  'cyclamen persicum': 'Florist cyclamen',
  'gardenia jasminoides': 'Cape jasmine',
  'ocimum basilicum': 'Basil',
  'mentha spicata': 'Spearmint',
  'rosmarinus officinalis': 'Rosemary',
  'salvia rosmarinus': 'Rosemary',
  'lavandula angustifolia': 'English lavender',
  'olea europaea': 'Olive tree',
  'citrus limon': 'Lemon tree',
};

/*
 * Reduce a botanical name to the key the table is written in.
 *
 * The same species reaches us spelled several ways depending on who answered:
 * PlantNet appends the naming authority ("Ficus lyrata Warb."), the model uses
 * the hybrid multiplication sign ("Alocasia × amazonica") or an ASCII "x", and
 * either may attach a cultivar in quotes ("Alocasia 'Polly'") or a rank marker
 * ("Alocasia macrorrhizos var. variegata"). All of those are the same plant to
 * a person, so all of them have to reach the same key.
 *
 * Exported for tests: this is where a missed lookup will come from, and each
 * spelling deserves to be pinned down without a network call.
 */
export function speciesKey(scientificName: string): string {
  if (typeof scientificName !== 'string') return '';

  const cleaned = scientificName
    // Cultivars and trade names: 'Polly', "Polly", (Polly).
    .replace(/['"“”‘’(][^'"“”‘’)]*['"“”‘’)]/g, ' ')
    .toLowerCase()
    // The hybrid marker carries no identity of its own, in either spelling.
    .replace(/[×✕]/g, ' ')
    .replace(/(^|\s)x(\s)/g, '$1 $2')
    // Rank markers sit between the species and an infraspecific name we do not
    // key on; dropping the marker and everything after it is the intent.
    .replace(/\s(var|subsp|ssp|cv|f)\.?\s.*$/, '')
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Genus and species only. Anything after is an authority ("Warb.", "Hook.f.")
  // or an infraspecific name, and neither belongs in the key.
  return cleaned.slice(0, 2).join(' ');
}

/*
 * The name to show a person, given what the identifier called this plant.
 *
 * `fallback` is returned untouched whenever the table has nothing to say, which
 * is the common case and must stay cheap and lossless. An empty fallback falls
 * through to the scientific name rather than to an empty headline - a screen
 * with no plant name on it reads as a broken app.
 */
export function friendlyName(scientificName: string, fallback: string): string {
  const key = speciesKey(scientificName);
  const genus = key.split(' ')[0];

  const named = COMMON_NAMES[key] ?? (genus ? COMMON_NAMES[genus] : undefined);
  if (named) return named;

  const trimmedFallback = typeof fallback === 'string' ? fallback.trim() : '';
  return trimmedFallback || scientificName.trim();
}
