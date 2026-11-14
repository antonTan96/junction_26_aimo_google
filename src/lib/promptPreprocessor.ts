import {
  type DecomposedIngredient,
  type PreprocessedPromptResult,
  type ProcurementRequestType,
  type RecipeMetadata,
} from '../types/aimogate.ts';
import { extractShortTags } from './aimogate.ts';
import { NemotronClient } from './nemotronClient.ts';

export interface BaseRecipeIngredient {
  name: string;
  searchQuery: string;
  baseQtyPer10Servings: number;
  unit: string;
  categoryHint: string;
  defaultTags?: string[];
  role: string;
  importance: 'essential' | 'optional' | 'substitute';
  glutenFreeSubstitute?: { name: string; searchQuery: string };
  veganSubstitute?: { name: string; searchQuery: string; categoryHint: string; defaultTags: string[] };
  lactoseFreeSubstitute?: { name: string; searchQuery: string; defaultTags: string[] };
}

export interface RecipeTemplate {
  name: string;
  aliases: string[];
  defaultYield: number;
  yieldUnit: string;
  cuisine: string;
  description: string;
  baseIngredients: BaseRecipeIngredient[];
}

export const CULINARY_RECIPE_DATABASE: Record<string, RecipeTemplate> = {
  cookies: {
    name: 'Cookies & Biscuits',
    aliases: ['cookie', 'cookies', 'keksi', 'keksit', 'keksejä', 'keksiä', 'pikkuleipä', 'pikkuleipiä', 'biscuit', 'biscuits'],
    defaultYield: 50,
    yieldUnit: 'cookies',
    cuisine: 'Bakery / Confectionery',
    description: 'Crispy artisanal baked cookies with butter, sugar, and flour base',
    baseIngredients: [
      {
        name: 'Wheat Flour / Baking Flour',
        searchQuery: 'vehnäjauho',
        baseQtyPer10Servings: 0.25, // 250g per 10 cookies -> 25kg for 1,000 cookies
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Flour structure & dough base',
        importance: 'essential',
        glutenFreeSubstitute: {
          name: 'Gluten-Free Flour / Cake Mix',
          searchQuery: 'gluteeniton jauhoseos',
        },
      },
      {
        name: 'Traditional Cooking Butter',
        searchQuery: 'meijerivoi',
        baseQtyPer10Servings: 0.15, // 150g per 10 cookies -> 15kg for 1,000 cookies
        unit: 'kg',
        categoryHint: 'dairy',
        role: 'Fat, richness & crumb texture',
        importance: 'essential',
        lactoseFreeSubstitute: {
          name: 'Lactose-Free Butter',
          searchQuery: 'laktoositon voi',
          defaultTags: ['lactose-free'],
        },
        veganSubstitute: {
          name: 'Baking Margarine (Plant-Based)',
          searchQuery: 'leivontamargariini',
          categoryHint: 'plant-based',
          defaultTags: ['vegan', 'plant-based'],
        },
      },
      {
        name: 'Granulated Sugar',
        searchQuery: 'sokeri',
        baseQtyPer10Servings: 0.12, // 120g per 10 cookies -> 12kg for 1,000 cookies
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Sweetener and caramelization',
        importance: 'essential',
      },
      {
        name: 'Baking Powder',
        searchQuery: 'leivinjauhe',
        baseQtyPer10Servings: 0.02,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Chemical leavening agent',
        importance: 'essential',
      },
      {
        name: 'Specialty Flavoring (Licorice / Chocolate)',
        searchQuery: 'lakritsi',
        baseQtyPer10Servings: 0.1,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Character flavoring and texture inclusions',
        importance: 'essential',
      },
    ],
  },
  cinnamon_buns: {
    name: 'Finnish Cinnamon Buns (Korvapuusti)',
    aliases: ['korvapuusti', 'korvapuustit', 'cinnamon bun', 'cinnamon buns', 'pulla', 'kanelbulle'],
    defaultYield: 20,
    yieldUnit: 'buns',
    cuisine: 'Nordic Bakery',
    description: 'Traditional Finnish spiced cardamom and cinnamon yeast buns',
    baseIngredients: [
      {
        name: 'Special Wheat Flour (Puolikarkea)',
        searchQuery: 'vehnäjauho puolikarkea',
        baseQtyPer10Servings: 0.45,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'High-protein yeast dough gluten structure',
        importance: 'essential',
        glutenFreeSubstitute: {
          name: 'Gluten-Free Bread Flour Mix',
          searchQuery: 'gluteeniton jauhoseos',
        },
      },
      {
        name: 'Whole Milk (Täysmaito)',
        searchQuery: 'täysmaito',
        baseQtyPer10Servings: 0.3,
        unit: 'L',
        categoryHint: 'dairy',
        role: 'Dough hydration and tenderness',
        importance: 'essential',
        lactoseFreeSubstitute: {
          name: 'Lactose-Free Whole Milk',
          searchQuery: 'laktoositon täysmaito',
          defaultTags: ['lactose-free'],
        },
        veganSubstitute: {
          name: 'Barista Oat Drink',
          searchQuery: 'kaurajuoma barista',
          categoryHint: 'plant-based',
          defaultTags: ['vegan', 'plant-based'],
        },
      },
      {
        name: 'Traditional Butter (Meijerivoi)',
        searchQuery: 'meijerivoi',
        baseQtyPer10Servings: 0.1,
        unit: 'kg',
        categoryHint: 'dairy',
        role: 'Dough enrichment and cinnamon filling',
        importance: 'essential',
        lactoseFreeSubstitute: {
          name: 'Lactose-Free Butter',
          searchQuery: 'laktoositon voi',
          defaultTags: ['lactose-free'],
        },
        veganSubstitute: {
          name: 'Plant-Based Margarine',
          searchQuery: 'leivontamargariini',
          categoryHint: 'plant-based',
          defaultTags: ['vegan', 'plant-based'],
        },
      },
      {
        name: 'Granulated Sugar',
        searchQuery: 'sokeri',
        baseQtyPer10Servings: 0.08,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Sweetening and yeast fermentation fuel',
        importance: 'essential',
      },
      {
        name: 'Fresh Baker’s Yeast',
        searchQuery: 'hiiva',
        baseQtyPer10Servings: 0.03,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Biological leavening',
        importance: 'essential',
      },
      {
        name: 'Ground Cardamom & Cinnamon Spices',
        searchQuery: 'kardemumma',
        baseQtyPer10Servings: 0.02,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Signature Nordic spice aroma',
        importance: 'essential',
      },
    ],
  },
  salmon_soup: {
    name: 'Traditional Finnish Salmon Soup (Lohikeitto)',
    aliases: ['salmon soup', 'lohikeitto', 'kalakeitto', 'laxsoppa', 'fish soup'],
    defaultYield: 10,
    yieldUnit: 'portions',
    cuisine: 'Nordic Culinary',
    description: 'Creamy Nordic fish chowder with fresh salmon, root vegetables, cream, and fresh dill',
    baseIngredients: [
      {
        name: 'Fresh Salmon Fillet',
        searchQuery: 'lohi filee',
        baseQtyPer10Servings: 1.5,
        unit: 'kg',
        categoryHint: 'meat',
        role: 'Primary rich protein',
        importance: 'essential',
      },
      {
        name: 'Waxy Boiling Potatoes',
        searchQuery: 'peruna',
        baseQtyPer10Servings: 1.5,
        unit: 'kg',
        categoryHint: 'produce',
        role: 'Hearty vegetable base',
        importance: 'essential',
      },
      {
        name: 'Fresh Carrots & Leek',
        searchQuery: 'porkkana',
        baseQtyPer10Servings: 0.5,
        unit: 'kg',
        categoryHint: 'produce',
        role: 'Aromatic vegetable sweetness',
        importance: 'essential',
      },
      {
        name: 'Heavy Cooking Cream (Kuohukerma)',
        searchQuery: 'kuohukerma',
        baseQtyPer10Servings: 0.6,
        unit: 'L',
        categoryHint: 'dairy',
        role: 'Velvety soup broth body and richness',
        importance: 'essential',
        lactoseFreeSubstitute: {
          name: 'Lactose-Free Whipping Cream (Laktoositon Kuohukerma)',
          searchQuery: 'laktoositon kuohukerma',
          defaultTags: ['lactose-free'],
        },
        veganSubstitute: {
          name: 'Oat Cooking Cream (Kauraruokakerma)',
          searchQuery: 'kauraruokakerma',
          categoryHint: 'plant-based',
          defaultTags: ['vegan', 'plant-based'],
        },
      },
      {
        name: 'Cooking Butter',
        searchQuery: 'meijerivoi',
        baseQtyPer10Servings: 0.1,
        unit: 'kg',
        categoryHint: 'dairy',
        role: 'Sweating aromatics and finishing sheen',
        importance: 'essential',
        lactoseFreeSubstitute: {
          name: 'Lactose-Free Butter',
          searchQuery: 'laktoositon voi',
          defaultTags: ['lactose-free'],
        },
      },
      {
        name: 'Fish Broth / Fond Concentrate',
        searchQuery: 'kalaliemi',
        baseQtyPer10Servings: 2.0,
        unit: 'L',
        categoryHint: 'general',
        role: 'Savory seafood umami stock',
        importance: 'essential',
      },
      {
        name: 'Fresh Dill',
        searchQuery: 'tilli',
        baseQtyPer10Servings: 0.1,
        unit: 'kg',
        categoryHint: 'produce',
        role: 'Classic herb garnish and fresh finish',
        importance: 'essential',
      },
    ],
  },
  pancakes: {
    name: 'Finnish Oven Pancake & Crepes (Pannukakku & Letut)',
    aliases: ['pancake', 'pancakes', 'pannukakku', 'letut', 'lätyt', 'räiskäleet', 'crepes'],
    defaultYield: 15,
    yieldUnit: 'portions',
    cuisine: 'Nordic Desserts',
    description: 'Golden oven-baked pancake with butter and eggs',
    baseIngredients: [
      {
        name: 'Whole Milk',
        searchQuery: 'täysmaito',
        baseQtyPer10Servings: 1.0,
        unit: 'L',
        categoryHint: 'dairy',
        role: 'Batter liquid base',
        importance: 'essential',
        lactoseFreeSubstitute: {
          name: 'Lactose-Free Milk',
          searchQuery: 'laktoositon maito',
          defaultTags: ['lactose-free'],
        },
        veganSubstitute: {
          name: 'Oat Drink Barista',
          searchQuery: 'kaurajuoma barista',
          categoryHint: 'plant-based',
          defaultTags: ['vegan', 'plant-based'],
        },
      },
      {
        name: 'Wheat Flour',
        searchQuery: 'vehnäjauho',
        baseQtyPer10Servings: 0.5,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Batter structure and thickening',
        importance: 'essential',
        glutenFreeSubstitute: {
          name: 'Gluten-Free Baking Mix',
          searchQuery: 'gluteeniton jauhoseos',
        },
      },
      {
        name: 'Fresh Eggs',
        searchQuery: 'kananmuna',
        baseQtyPer10Servings: 0.3,
        unit: 'kg',
        categoryHint: 'dairy',
        role: 'Custard binding and puffing',
        importance: 'essential',
      },
      {
        name: 'Butter',
        searchQuery: 'meijerivoi',
        baseQtyPer10Servings: 0.1,
        unit: 'kg',
        categoryHint: 'dairy',
        role: 'Browning and rich flavor',
        importance: 'essential',
        lactoseFreeSubstitute: {
          name: 'Lactose-Free Butter',
          searchQuery: 'laktoositon voi',
          defaultTags: ['lactose-free'],
        },
      },
      {
        name: 'Sugar & Salt',
        searchQuery: 'sokeri',
        baseQtyPer10Servings: 0.05,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Flavor balance',
        importance: 'essential',
      },
    ],
  },
  tiramisu: {
    name: 'Classic Restaurant Tiramisu',
    aliases: ['tiramisu', 'tiramisù'],
    defaultYield: 12,
    yieldUnit: 'portions',
    cuisine: 'Italian Desserts',
    description: 'Espresso-soaked savoiardi ladyfingers layered with whipped mascarpone cream',
    baseIngredients: [
      {
        name: 'Italian Mascarpone Cream Cheese',
        searchQuery: 'mascarpone',
        baseQtyPer10Servings: 0.5,
        unit: 'kg',
        categoryHint: 'dairy',
        role: 'Velvety cheese cream layer',
        importance: 'essential',
      },
      {
        name: 'Savoiardi Ladyfinger Biscuits',
        searchQuery: 'savoiardi',
        baseQtyPer10Servings: 0.3,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Sponge biscuit base',
        importance: 'essential',
        glutenFreeSubstitute: {
          name: 'Gluten-Free Savoiardi / Biscuit',
          searchQuery: 'gluteeniton keksi',
        },
      },
      {
        name: 'Heavy Whipping Cream',
        searchQuery: 'kuohukerma',
        baseQtyPer10Servings: 0.4,
        unit: 'L',
        categoryHint: 'dairy',
        role: 'Light aerated cream volume',
        importance: 'essential',
        lactoseFreeSubstitute: {
          name: 'Lactose-Free Whipping Cream',
          searchQuery: 'laktoositon kuohukerma',
          defaultTags: ['lactose-free'],
        },
      },
      {
        name: 'Espresso Roast Coffee Beans',
        searchQuery: 'espresso papu',
        baseQtyPer10Servings: 0.1,
        unit: 'kg',
        categoryHint: 'beverages',
        role: 'Robust coffee soaking syrup',
        importance: 'essential',
      },
      {
        name: 'Cocoa Powder',
        searchQuery: 'kaakaojauhe',
        baseQtyPer10Servings: 0.04,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Bitter dusting top layer',
        importance: 'essential',
      },
    ],
  },
  pizza: {
    name: 'Artisanal Pan & Stone Pizza',
    aliases: ['pizza', 'pizzat', 'panpizza'],
    defaultYield: 10,
    yieldUnit: 'pizzas',
    cuisine: 'Italian / Fast Casual',
    description: 'Neapolitan and sourdough pizza with tomato sauce and mozzarella',
    baseIngredients: [
      {
        name: 'Pizza Flour / Pre-cooked Pizza Base',
        searchQuery: 'pizzapohja',
        baseQtyPer10Servings: 2.0,
        unit: 'kg',
        categoryHint: 'bakery',
        role: 'Crust foundation',
        importance: 'essential',
        glutenFreeSubstitute: {
          name: 'Gluten-Free Pizza Base',
          searchQuery: 'gluteeniton pizzapohja',
        },
      },
      {
        name: 'Grated Mozzarella / Pizza Cheese',
        searchQuery: 'pizzajuusto mozzarella',
        baseQtyPer10Servings: 1.5,
        unit: 'kg',
        categoryHint: 'dairy',
        role: 'Melt, stretch and browning',
        importance: 'essential',
        lactoseFreeSubstitute: {
          name: 'Lactose-Free Pizza Cheese',
          searchQuery: 'laktoositon juusto',
          defaultTags: ['lactose-free'],
        },
        veganSubstitute: {
          name: 'Vegan Pizza Topping',
          searchQuery: 'vegaaninen juusto',
          categoryHint: 'plant-based',
          defaultTags: ['vegan', 'plant-based'],
        },
      },
      {
        name: 'Crushed Tomato Pizza Sauce',
        searchQuery: 'tomaattimurska',
        baseQtyPer10Servings: 1.0,
        unit: 'kg',
        categoryHint: 'produce',
        role: 'Tangy savory tomato spread',
        importance: 'essential',
      },
    ],
  },
};

/**
 * Normalizes units to canonical metric procurement units.
 */
export function normalizeUnit(rawUnit: string): string {
  const u = rawUnit.toLowerCase().trim();
  if (/^(?:l|litre|liter|litres|liters|litraa?)$/.test(u)) return 'L';
  if (/^(?:kg|kilo|kilos|kilograms?|kiloa?)$/.test(u)) return 'kg';
  if (/^(?:g|gram|grams|grammaa?)$/.test(u)) return 'kg'; // 1000g normalized during quantity parse
  if (/^(?:kpl|pcs|pieces?|units?|croissants?|cookies?)$/.test(u)) return 'units';
  if (/^(?:boxes?|laatikkoa?|cases?|cartons?)$/.test(u)) return 'boxes';
  if (/^(?:packs?|pussia?|packets?)$/.test(u)) return 'packs';
  return u || 'units';
}

/**
 * Deduce ingredients for a named recipe from the culinary ontology.
 */
export function deduceRecipeFromOntology(
  recipeKey: string,
  targetYield: number,
  dietaryTags: string[] = [],
  specialtyVariant?: string
): DecomposedIngredient[] {
  const tmpl = CULINARY_RECIPE_DATABASE[recipeKey];
  if (!tmpl) return [];

  const scale = targetYield > 0 ? targetYield / 10 : 1.0;
  const isGlutenFree = dietaryTags.includes('gluten-free');
  const isVegan = dietaryTags.includes('vegan');
  const isLactoseFree = dietaryTags.includes('lactose-free');

  return tmpl.baseIngredients.map((ing) => {
    let name = ing.name;
    let query = ing.searchQuery;
    let cat = ing.categoryHint;
    const tags = new Set<string>(ing.defaultTags || []);

    // Apply dietary adaptations
    if (isGlutenFree && ing.glutenFreeSubstitute) {
      name = ing.glutenFreeSubstitute.name;
      query = ing.glutenFreeSubstitute.searchQuery;
      tags.add('gluten-free');
    }
    if (isVegan && ing.veganSubstitute) {
      name = ing.veganSubstitute.name;
      query = ing.veganSubstitute.searchQuery;
      cat = ing.veganSubstitute.categoryHint;
      tags.add('vegan');
      tags.add('plant-based');
    } else if (isLactoseFree && ing.lactoseFreeSubstitute) {
      name = ing.lactoseFreeSubstitute.name;
      query = ing.lactoseFreeSubstitute.searchQuery;
      tags.add('lactose-free');
    }

    // Special inclusions (e.g. licorice cookies vs chocolate cookies)
    if (recipeKey === 'cookies' && specialtyVariant) {
      if (specialtyVariant.includes('licorice') || specialtyVariant.includes('lakritsi')) {
        if (ing.name.includes('Specialty Flavoring')) {
          name = 'Licorice Confectionery / Extract';
          query = isGlutenFree ? 'gluteeniton lakritsi' : 'lakritsi';
        }
      } else if (specialtyVariant.includes('chocolate') || specialtyVariant.includes('suklaa')) {
        if (ing.name.includes('Specialty Flavoring')) {
          name = 'Chocolate Chips / Drops';
          query = 'suklaanappi';
        }
      }
    }

    const calculatedQty = Number((ing.baseQtyPer10Servings * scale).toFixed(2));
    const roundedQty = Math.max(0.1, calculatedQty);

    return {
      ingredient_name: name,
      search_query: query,
      quantity: roundedQty,
      unit: ing.unit,
      category_hint: cat,
      dietary_tags: Array.from(tags),
      importance: ing.importance,
      culinary_role: ing.role,
    };
  });
}

/**
 * Parse an explicit multi-material or comma-separated recipe string.
 */
export function parseExplicitMaterialList(text: string, dietaryTags: string[] = []): DecomposedIngredient[] {
  // Strip meta phrases before splitting, so "Find an option based on price and availability" does not create false items
  const cleanInput = text
    .replace(/\b(?:find\s+an\s+option|check\s+(?:price|availability)|based\s+on\s+(?:price|availability)).*$/gi, '')
    .replace(/\bhinnan\s+ja\s+saatavuuden\s+mukaan.*$/gi, '')
    .replace(/\b(?:by|before|until)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|asap).*$/gi, '')
    .replace(/(\d+),(\d{3})\b/g, '$1$2')
    .replace(/^(?:recipe\s+for\s+[^:,\n]+[:,\-]|resepti\s*:\s*|ingredients\s*:\s*|ainekset\s*:\s*)/i, '')
    .trim();

  // Split on "and", "plus", "sekä", "ja", semicolons, commas preceding numbers or quantities, or newlines
  const segments = cleanInput
    .split(/\n+|;\s*|\s+(?:and|plus|sekä|ja)\s+|,\s*(?=\d|\ban?\b|\bsome\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const items: DecomposedIngredient[] = [];

  for (let seg of segments) {
    seg = seg
      .replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:order|buy|purchase|deliver|we\s+need|restock|get\s+us|i\s+need|send|tilatkaa|tarvitsemme)\s+/gi, '')
      .trim();

    // Quantity regex: e.g. "50 liters of organic whole milk", "10kg butter", "20 boxes croissants"
    const volMatch = seg.match(/^([\d,]+(?:\.\d+)?)\s*(l|litres?|liter|liters|litraa?|kg|kilo|kilos|kiloa?)\b\s*(?:of\s+)?(.*)$/i);
    const gramMatch = seg.match(/^([\d,]+(?:\.\d+)?)\s*(g|gram|grams|grammaa?)\b\s*(?:of\s+)?(.*)$/i);
    const qtyMatch = seg.match(/^([\d,]+)\s*(kpl|pcs|units?|boxes?|laatikkoa?|packs?|pussia?|canisters?|bottles?|pulloa?|croissants?|cases?|cartons?)\b\s*(?:of\s+)?(.*)$/i);

    let qty = 1;
    let unit = 'units';
    let itemName = seg;

    if (volMatch) {
      qty = parseFloat(volMatch[1].replace(/,/g, ''));
      unit = normalizeUnit(volMatch[2]);
      itemName = volMatch[3] || seg;
    } else if (gramMatch) {
      qty = parseFloat(gramMatch[1].replace(/,/g, '')) / 1000.0;
      unit = 'kg';
      itemName = gramMatch[3] || seg;
    } else if (qtyMatch) {
      qty = parseFloat(qtyMatch[1].replace(/,/g, ''));
      unit = normalizeUnit(qtyMatch[2]);
      itemName = qtyMatch[3] || seg;
    } else {
      // Standalone number prefix like "50 salmon fillet"
      const numMatch = seg.match(/^([\d,]+)\s+(.*)$/);
      if (numMatch) {
        qty = parseFloat(numMatch[1].replace(/,/g, ''));
        itemName = numMatch[2];
      }
    }

    const cleanItem = itemName
      .replace(/\bfor\s+(?:the\s+)?(?:bakery|kitchen|cafeteria|breakfast|event)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const stopWords = /^(?:availability|price|saatavuus|hinta|option|options|requirement|requirements|asap|friday|monday|thursday|tuesday|wednesday|saturday|sunday)$/i;
    if (!cleanItem || stopWords.test(cleanItem)) continue;

    // Detect category hint
    let catHint = 'dairy';
    const lower = cleanItem.toLowerCase();
    if (lower.includes('milk') || lower.includes('maito') || lower.includes('butter') || lower.includes('voi') || lower.includes('cream') || lower.includes('juusto') || lower.includes('cheese')) {
      catHint = 'dairy';
    } else if (lower.includes('oat') || lower.includes('kaura') || lower.includes('soija') || lower.includes('vegan')) {
      catHint = 'plant-based';
    } else if (lower.includes('bread') || lower.includes('croissant') || lower.includes('flour') || lower.includes('jauho') || lower.includes('cookie') || lower.includes('keksi') || lower.includes('bakery')) {
      catHint = 'bakery';
    } else if (lower.includes('coffee') || lower.includes('kahvi') || lower.includes('tea') || lower.includes('juice') || lower.includes('mehu')) {
      catHint = 'beverages';
    } else if (lower.includes('salmon') || lower.includes('lohi') || lower.includes('meat') || lower.includes('chicken') || lower.includes('kana') || lower.includes('kala')) {
      catHint = 'meat';
    } else if (lower.includes('potato') || lower.includes('peruna') || lower.includes('carrot') || lower.includes('porkkana') || lower.includes('onion') || lower.includes('dill')) {
      catHint = 'produce';
    } else if (lower.includes('hygiene') || lower.includes('sanitizer') || lower.includes('clean')) {
      catHint = 'cleaning';
    }

    const itemTags = extractShortTags(cleanItem);
    const combinedTags = Array.from(new Set([...dietaryTags, ...itemTags]));

    items.push({
      ingredient_name: cleanItem,
      search_query: cleanItem,
      quantity: qty,
      unit,
      category_hint: catHint,
      dietary_tags: combinedTags,
      importance: 'essential',
      culinary_role: 'Procurement line item',
    });
  }

  return items;
}

/**
 * Preprocess natural language buyer prompts synchronously into structured procurement items,
 * identifying recipes, deducing necessary raw materials, and scaling quantities deterministically.
 */
export function preprocessBuyerPromptSync(
  prompt: string,
  now: Date = new Date()
): PreprocessedPromptResult {
  const tLower = prompt.toLowerCase();
  const dietaryTags = extractShortTags(prompt);

  // Calculate standard delivery date
  const weekday = now.getUTCDay(); // 0=Sun, 1=Mon
  let daysAhead = (1 - weekday + 7) % 7;
  if (daysAhead <= 1) daysAhead += 7;
  const deliverBy = new Date(now.getTime() + daysAhead * 86400_000 + 8 * 3600_000).toISOString();

  // 1. Identify if prompt contains a known recipe from the culinary ontology
  let matchedRecipeKey: string | null = null;
  for (const [key, tmpl] of Object.entries(CULINARY_RECIPE_DATABASE)) {
    const hitsAlias = tmpl.aliases.some((alias) => new RegExp(`\\b${alias}\\b`, 'i').test(tLower));
    if (hitsAlias) {
      matchedRecipeKey = key;
      break;
    }
  }

  // Detect recipe intent indicators
  const isRecipePrompt =
    matchedRecipeKey !== null &&
    (tLower.includes('ingredient') ||
      tLower.includes('ainekset') ||
      tLower.includes('recipe') ||
      tLower.includes('resepti') ||
      tLower.includes('bake') ||
      tLower.includes('cook') ||
      tLower.includes('make') ||
      tLower.includes('wedding') ||
      tLower.includes('event') ||
      tLower.includes('people') ||
      tLower.includes('guests') ||
      tLower.includes('portions') ||
      tLower.includes('servings') ||
      tLower.includes('soup') ||
      tLower.includes('buns') ||
      tLower.includes('cookies'));

  if (isRecipePrompt && matchedRecipeKey) {
    const tmpl = CULINARY_RECIPE_DATABASE[matchedRecipeKey];

    // Detect target yield / servings: e.g. "1,000 cookies", "50 people", "200 guests", "20 buns"
    const yieldMatch = tLower.match(/([\d,]+)\s*(?:(?:[\w-]+\s+){0,3})?(?:cookies?|keksejä|keksiä|buns?|puustia?|people|guests?|henkeä|annosta|portions?|servings?|pizzas?)\b/i);
    let targetYield = tmpl.defaultYield;
    if (yieldMatch) {
      targetYield = parseFloat(yieldMatch[1].replace(/,/g, ''));
    }

    // Detect specialty flavors (e.g. licorice cookies, chocolate cookies)
    let specialty: string | undefined = undefined;
    if (tLower.includes('licorice') || tLower.includes('lakritsi')) specialty = 'licorice';
    if (tLower.includes('chocolate') || tLower.includes('suklaa')) specialty = 'chocolate';

    const ingredients = deduceRecipeFromOntology(matchedRecipeKey, targetYield, dietaryTags, specialty);

    return {
      raw_prompt: prompt,
      request_type: 'recipe',
      recipe: {
        name: tmpl.name,
        servings_or_yield: targetYield,
        yield_unit: tmpl.yieldUnit,
        cuisine: tmpl.cuisine,
        description: tmpl.description,
      },
      dietary_tags: dietaryTags,
      deliver_by: deliverBy,
      items: ingredients,
      notes: `Deduced ${ingredients.length} required ingredients for ${tmpl.name} (Yield: ${targetYield} ${tmpl.yieldUnit}) based on professional kitchen recipe ontology.`,
    };
  }

  // 2. Identify if prompt provides an explicit recipe breakdown or ingredient list
  // e.g. "Recipe for strawberry cake: 500g strawberries, 200g sugar, 4 eggs, 250g flour"
  const isExplicitRecipeList =
    (tLower.includes('recipe for') || tLower.includes('resepti:') || tLower.includes('ingredients:')) &&
    (tLower.includes(',') || tLower.includes('\n') || tLower.includes(' and '));

  if (isExplicitRecipeList) {
    const recipeNameMatch = prompt.match(/(?:recipe\s+for|resepti:?)\s+([^:,\n]+)/i);
    const extractedRecipeName = recipeNameMatch ? recipeNameMatch[1].trim() : 'Custom Kitchen Recipe';
    const items = parseExplicitMaterialList(prompt, dietaryTags);
    if (items.length > 1) {
      return {
        raw_prompt: prompt,
        request_type: 'recipe',
        recipe: {
          name: extractedRecipeName,
          servings_or_yield: 10,
          yield_unit: 'portions',
          cuisine: 'Commercial Kitchen',
          description: `Custom kitchen recipe: ${extractedRecipeName}`,
        },
        dietary_tags: dietaryTags,
        deliver_by: deliverBy,
        items,
        notes: `Structured explicit kitchen recipe with ${items.length} line item ingredients.`,
      };
    }
  }

  // 3. Identify if prompt contains multiple materials joined by "and", commas, or line breaks
  const cleanedPromptForMulti = prompt
    .replace(/\b(?:find\s+an\s+option|check\s+(?:price|availability)|based\s+on\s+(?:price|availability)).*$/gi, '')
    .replace(/\bhinnan\s+ja\s+saatavuuden\s+mukaan.*$/gi, '')
    .trim();

  const hasMultipleItems =
    /\b(?:and|plus|sekä)\b/i.test(cleanedPromptForMulti) &&
    /\d+\s*(?:l|litres?|kg|kilo|boxes?|cartons?|packs?|units?)/i.test(cleanedPromptForMulti);

  if (hasMultipleItems) {
    const items = parseExplicitMaterialList(prompt, dietaryTags);
    if (items.length > 1) {
      return {
        raw_prompt: prompt,
        request_type: 'multi_item',
        dietary_tags: dietaryTags,
        deliver_by: deliverBy,
        items,
        notes: `Decomposed multi-item procurement request into ${items.length} distinct product lines.`,
      };
    }
  }

  // 4. Default: Single Item Procurement Request
  const singleItems = parseExplicitMaterialList(prompt, dietaryTags);
  const primaryItem = singleItems[0] || {
    ingredient_name: prompt.trim(),
    search_query: prompt.trim(),
    quantity: 1,
    unit: 'units',
    category_hint: 'dairy',
    dietary_tags: dietaryTags,
    importance: 'essential' as const,
  };

  return {
    raw_prompt: prompt,
    request_type: 'single_item',
    dietary_tags: dietaryTags,
    deliver_by: deliverBy,
    items: [primaryItem],
    notes: 'Single product procurement intent.',
  };
}

/**
 * Preprocess natural language buyer prompts into structured procurement items,
 * identifying recipes, deducing necessary raw materials, and scaling quantities.
 * Async wrapper with optional Nemotron LLM fallback for open-ended uncataloged recipes.
 */
export async function preprocessBuyerPrompt(
  prompt: string,
  now: Date = new Date()
): Promise<PreprocessedPromptResult> {
  const syncResult = preprocessBuyerPromptSync(prompt, now);
  if (syncResult.request_type !== 'single_item') {
    return syncResult;
  }

  const tLower = prompt.toLowerCase();
  // Optional Remote LLM Hook: If Nemotron is active and prompt asks for an uncataloged custom recipe
  if (
    process.env.DISABLE_REMOTE_LLM !== 'true' &&
    (tLower.includes('recipe') || tLower.includes('ingredients for') || tLower.includes('ainekset'))
  ) {
    try {
      const nemotron = NemotronClient.getInstance();
      const llmResult = await queryNemotronForRecipe(prompt, nemotron);
      if (llmResult && llmResult.items && llmResult.items.length > 0) {
        return {
          ...llmResult,
          raw_prompt: prompt,
          deliver_by: syncResult.deliver_by,
        };
      }
    } catch {
      // Fallback gracefully to sync result
    }
  }

  return syncResult;
}

/**
 * Invoke remote NVIDIA Nemotron LLM to parse open-ended or custom recipes into structured JSON.
 */
async function queryNemotronForRecipe(
  prompt: string,
  nemotron: NemotronClient
): Promise<PreprocessedPromptResult | null> {
  const systemPrompt = `You are an expert commercial chef and B2B procurement analyst for Valio Aimo food wholesale.
When given a recipe or procurement prompt, deduce the raw ingredients needed to prepare it.
Output strictly valid JSON matching this schema:
{
  "request_type": "recipe" | "multi_item",
  "recipe": {
    "name": string,
    "servings_or_yield": number,
    "yield_unit": string,
    "cuisine": string
  },
  "dietary_tags": string[],
  "items": [
    {
      "ingredient_name": string,
      "search_query": string,
      "quantity": number,
      "unit": "kg" | "L" | "units" | "packs",
      "category_hint": "dairy" | "bakery" | "produce" | "meat" | "beverages" | "plant-based" | "cleaning",
      "dietary_tags": string[],
      "importance": "essential" | "optional",
      "culinary_role": string
    }
  ]
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000); // 6s timeout

  try {
    const res = await fetch(`${nemotron.getEndpoint().replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${(nemotron as any).apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: nemotron.getModelName(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Deduce ingredients and quantities for: "${prompt}"` },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1024,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content);
  } catch {
    clearTimeout(timeout);
    return null;
  }
}
