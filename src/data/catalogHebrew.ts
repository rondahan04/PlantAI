/*
 * Hebrew names for the parts of the catalog that genuinely have them.
 *
 * WHY THIS IS A SEPARATE FILE, keyed by English string, rather than a `nameHe`
 * on each of the 359 entries: almost every entry is a cultivar trade name -
 * "Thai Constellation", "Black Velvet", "Dragon Scale" - and Israeli growers
 * say those in English. Transliterating them would produce a label nobody
 * recognises and, worse, a search term nobody types. What DOES have a real
 * Hebrew name is the level above: the family, the genus, and the shelf-label
 * group. Translating those makes the picker read as Hebrew while leaving the
 * cultivar names people actually shop for intact.
 *
 * Anything absent falls through to English, which is the correct outcome
 * rather than a gap to fill later.
 *
 * Genus names are mostly established transliterations, which is what Israeli
 * nurseries print on their labels - מונסטרה, פילודנדרון, אלוקזיה. A few have a
 * true Hebrew name in common use (סנסיביירה is also לשון החותנת, "mother-in-
 * law's tongue"); where both circulate, the transliteration is the display name
 * and the descriptive name is a search synonym in HEBREW_SYNONYMS, because the
 * label on the pot is what someone is holding when they open this screen.
 */

/* Family and shelf-group names: the descriptive Hebrew, not a transliteration,
 * because these are categories rather than labels. */
const FAMILIES: Record<string, string> = {
  Aroids: 'ארואידים',
  Begonias: 'בגוניות',
  Cacti: 'קקטוסים',
  Dracaenas: 'דרצנות',
  Ferns: 'שרכים',
  Figs: 'פיקוסים',
  Hoyas: 'הויות',
  Palms: 'דקלים',
  Peperomias: 'פפרומיות',
  'Prayer Plants': 'צמחי תפילה',
  Succulents: 'סוקולנטים',
};

const GENERA: Record<string, string> = {
  Adiantum: 'שערות שולמית',
  Alocasia: 'אלוקזיה',
  Aloe: 'אלוורה',
  Anthurium: 'אנתוריום',
  Asplenium: 'אספלניום',
  Begonia: 'בגוניה',
  Calathea: 'קלתיאה',
  Chamaedorea: 'כמדוריאה',
  Colocasia: 'קולוקסיה',
  Crassula: 'קרסולה',
  Ctenanthe: 'קטנתה',
  Dracaena: 'דרצנה',
  Dypsis: 'דיפסיס',
  Echeveria: 'אכוריה',
  Epiphyllum: 'אפיפילום',
  Epipremnum: 'אפיפרמנום',
  Ficus: 'פיקוס',
  Haworthia: 'הוורתיה',
  Howea: 'הוויאה',
  Hoya: 'הויה',
  Mammillaria: 'ממילריה',
  Maranta: 'מרנטה',
  Monstera: 'מונסטרה',
  Nephrolepis: 'נפרולפיס',
  Opuntia: 'צבר',
  Peperomia: 'פפרומיה',
  Philodendron: 'פילודנדרון',
  Platycerium: 'קרן הצבי',
  Pteris: 'פטריס',
  Rhaphidophora: 'רפידופורה',
  Rhapis: 'רפיס',
  Sansevieria: 'סנסיביירה',
  Schlumbergera: 'שלומברגרה',
  Scindapsus: 'סקינדפסוס',
  Stromanthe: 'סטרומנתה',
  Syngonium: 'סינגוניום',
};

const GROUPS: Record<string, string> = {
  Aloes: 'אלוורות',
  'Areca Palms': 'דקלי ארקה',
  'Boston Ferns': 'שרכי בוסטון',
  Calatheas: 'קלתיאות',
  'Cane Begonias': 'בגוניות קנה',
  'Climbing Philodendrons': 'פילודנדרונים מטפסים',
  'Common Alocasias': 'אלוקזיות נפוצות',
  'Common Hoyas': 'הויות נפוצות',
  Ctenanthes: 'קטנתות',
  Dracaenas: 'דרצנות',
  Echeverias: 'אכוריות',
  'Elephant Ears': 'אוזני פיל',
  Ficus: 'פיקוסים',
  'Flowering Anthuriums': 'אנתוריומים פורחים',
  Haworthias: 'הוורתיות',
  'Holiday Cacti': 'קקטוסי חג',
  'Jade Plants': 'עץ האהבה',
  'Jewel Alocasias': 'אלוקזיות תכשיט',
  'Kentia Palms': 'דקלי קנטיה',
  'Lady Palms': 'דקלי רפיס',
  'Maidenhair Ferns': 'שערות שולמית',
  Marantas: 'מרנטות',
  Monstera: 'מונסטרה',
  'Orchid Cacti': 'קקטוסי סחלב',
  'Parlor Palms': 'דקלי סלון',
  Peperomias: 'פפרומיות',
  'Pincushion Cacti': 'קקטוסי כרית סיכות',
  Pothos: 'פותוס',
  'Prickly Pears': 'צברים',
  'Rare Alocasias': 'אלוקזיות נדירות',
  'Rare Anthuriums': 'אנתוריומים נדירים',
  'Rare Hoyas': 'הויות נדירות',
  'Rare Philodendrons': 'פילודנדרונים נדירים',
  'Rex Begonias': 'בגוניות רקס',
  Rhaphidophora: 'רפידופורה',
  Scindapsus: 'סקינדפסוס',
  'Self-heading Philodendrons': 'פילודנדרונים זקופים',
  'Snake Plants': 'לשון החותנת',
  'Staghorn Ferns': 'שרכי קרן הצבי',
  Stromanthes: 'סטרומנתות',
  Syngonium: 'סינגוניום',
  'Table Ferns': 'שרכי שולחן',
  'Variegated Alocasias': 'אלוקזיות מגוונות',
  'Variegated Monstera': 'מונסטרה מגוונת',
  'Variegated Philodendrons': 'פילודנדרונים מגוונים',
  'Velvet Anthuriums': 'אנתוריומי קטיפה',
};

export const HEBREW_TAXA: Record<string, string> = { ...FAMILIES, ...GENERA, ...GROUPS };

/*
 * Extra Hebrew spellings the search should match but which are NOT display
 * names: the descriptive name where a transliteration is what the label says,
 * and the common misspellings that follow from writing a Latin name in Hebrew
 * letters. Keyed by the same English taxon, and folded into the same haystack.
 */
export const HEBREW_SYNONYMS: Record<string, string[]> = {
  Sansevieria: ['לשון החותנת', 'סנסווריה'],
  Epipremnum: ['פותוס'],
  Aloe: ['אלוי', 'אלו ורה'],
  Crassula: ['עץ האהבה', 'קרסולה אובטה'],
  Monstera: ['מונסטרה דליציוזה', 'צמח הגבינה'],
  Philodendron: ['פילודנדרון', 'פילו'],
  Ficus: ['פיקוס בנימינה', 'פיקוס ליראטה'],
  Platycerium: ['קרן איל'],
  Adiantum: ['אדיאנטום'],
  Opuntia: ['אופונטיה', 'צבר בר'],
  Anthurium: ['אנטוריום'],
  Alocasia: ['אלוקסיה'],
  Calathea: ['קלטיאה'],
  Dracaena: ['דרקנה'],
  Hoya: ['הויא', 'צמח השעווה'],
};
