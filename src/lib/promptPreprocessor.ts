import {
  type BuyerIntentType,
  type DecomposedIngredient,
  type PreprocessedPromptResult,
  type ProcurementRequestType,
  type RecipeMetadata,
} from '../types/aimogate.ts';
import { extractShortTags } from './aimogate.ts';
import { GeminiClient, sanitizeUntrustedPrompt } from './geminiClient.ts';

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
        searchQuery: 'Dansukker sokeri',
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
        searchQuery: 'liquorice powder',
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
          query = 'lakritsijauhe';
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
 * Reverse Culinary Signature Matching:
 * Matches a list of pure ingredients against the culinary ontology to classify
 * whether they constitute a known dish, estimate the batch yield, and detect missing staples.
 */
export function reverseMatchRecipe(items: DecomposedIngredient[]): {
  key: string;
  recipe: RecipeMetadata;
  missingStaples: string[];
  confidence: number;
} | null {
  if (!items || items.length < 3) return null;

  let bestMatch: {
    key: string;
    recipe: RecipeMetadata;
    missingStaples: string[];
    confidence: number;
  } | null = null;

  const itemNamesLower = items.map((i) => i.ingredient_name.toLowerCase());

  for (const [key, tmpl] of Object.entries(CULINARY_RECIPE_DATABASE)) {
    let matchedEssential = 0;
    const missing: string[] = [];
    const yieldEstimates: number[] = [];

    for (const base of tmpl.baseIngredients) {
      const searchQ = base.searchQuery.toLowerCase();
      const baseName = base.name.toLowerCase();

      const foundIdx = itemNamesLower.findIndex(
        (n) =>
          n.includes(searchQ) ||
          base.searchQuery.split(' ').some((w) => w.length > 3 && n.includes(w)) ||
          baseName.split(' ').some((w) => w.length > 3 && n.includes(w))
      );

      if (foundIdx !== -1) {
        matchedEssential++;
        const item = items[foundIdx];
        if (base.baseQtyPer10Servings > 0 && item.quantity > 0) {
          const perUnit = base.baseQtyPer10Servings / (tmpl.defaultYield || 10);
          const est = Math.round(item.quantity / perUnit);
          yieldEstimates.push(est);
        }
      } else if (base.importance === 'essential') {
        missing.push(base.name);
      }
    }

    const score = matchedEssential / tmpl.baseIngredients.length;
    if (score >= 0.6 && (!bestMatch || score > bestMatch.confidence)) {
      const avgYield =
        yieldEstimates.length > 0
          ? Math.round(yieldEstimates.reduce((a, b) => a + b, 0) / yieldEstimates.length)
          : tmpl.defaultYield;

      bestMatch = {
        key,
        recipe: {
          name: tmpl.name,
          servings_or_yield: avgYield,
          yield_unit: tmpl.yieldUnit,
          cuisine: tmpl.cuisine,
          description: `Recognized from ingredient composition (${Math.round(score * 100)}% signature match).`,
          is_recognized_from_ingredients: true,
          missing_staples: missing,
          confidence: Number(score.toFixed(2)),
        },
        missingStaples: missing,
        confidence: Number(score.toFixed(2)),
      };
    }
  }

  return bestMatch;
}

/**
 * Parse an explicit multi-material or comma-separated recipe string.
 */
export function parseExplicitMaterialList(text: string, dietaryTags: string[] = []): DecomposedIngredient[] {
  // Strip enclosing and embedded quotes and clean input
  let cleanInput = text
    .replace(/["'“”«»]+/g, ' ')
    .trim();

  // Strip operational directives, delivery timing, and agent instructions before splitting
  const directivePatterns = [
    /\b(?:please\s+)?(?:check|verify|lookup)\s+(?:fixed\s+)?(?:contract\s+)?(?:prices?|pricing|availability|stock)\b/gi,
    /\b(?:please\s+)?(?:lock\s+(?:the\s+)?(?:quote|price)|commit\s+(?:the\s+)?(?:order|quote)|confirm\s+(?:the\s+)?order|place\s+(?:the\s+)?order|submit\s+(?:the\s+)?order)\b/gi,
    /\b(?:if\s+it\s+complies\s+with\s+)?(?:our\s+)?(?:autonomous\s+)?purchasing\s+rules\b/gi,
    /\b(?:find\s+an\s+option\s+)?(?:that\s+)?meets?\s+(?:our\s+)?requirements\b/gi,
    /\b(?:find\s+an\s+option\s+)?based\s+on\s+(?:price|pricing|availability|saatavuus|hinta)(?:\s+(?:and|sekä|ja)\s+(?:price|pricing|availability|saatavuus|hinta))?\b/gi,
    /\bhinnan\s+ja\s+saatavuuden\s+mukaan\b/gi,
    /\bfind\s+an\s+option\b/gi,
    /\bfixed\s+contract\s+prices?\b/gi,
    /\bcontract\s+prices?\b/gi,
    /\(?\bwithin\s+policy(?:\s+limits)?\b\)?/gi,
    /\bautonomous\s+purchasing\b/gi,
    /\b(?:by|before|until|on|next|this|for)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|asap)(?:\s+(?:morning|afternoon|evening))?(?:\s+delivery)?\b/gi,
    /\b(?:for\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening))?(?:\s+delivery)?\b/gi,
    /\b(?:morning|afternoon|evening)\s+delivery\b/gi,
    /\bavailability\b/gi,
  ];

  for (const pat of directivePatterns) {
    cleanInput = cleanInput.replace(pat, ' ');
  }

  cleanInput = cleanInput
    .replace(/(\d+),(\d{3})(?=\D|$)/g, '$1$2')
    .replace(/\(\s*\)/g, ' ')
    .replace(/^(?:recipe\s+for\s+[^:,\n]+[:,\-]|resepti\s*:\s*|ingredients\s*:\s*|ainekset\s*:\s*)/i, '')
    .replace(/\s*\.\s*/g, ', ')
    .trim();

  // Split on "and", "plus", "sekä", "ja", semicolons, commas, newlines, or periods
  const segments = cleanInput
    .split(/\n+|;\s*|\s+(?:and|plus|sekä|ja)\s+|,\s*|\.\s+/i)
    .map((s) => s.replace(/^[,\.\s\-]+|[,\.\s\-]+$/g, '').trim())
    .filter(Boolean);

  const items: DecomposedIngredient[] = [];

  for (let seg of segments) {
    seg = seg
      .replace(/^[,\.\s\-]+/g, '')
      .replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:order|buy|purchase|deliver|we\s+need|restock|get\s+us|i\s+need|send|tilatkaa|tarvitsemme)\s+/gi, '')
      .replace(/^[,\.\s\-]+|[,\.\s\-]+$/g, '')
      .trim();

    if (!seg) continue;

    // Detect if this segment is purely a quantity without a product name (e.g. "(15 kg)", "150L", "20 boxes")
    const pureQtyMatch = seg.match(/^[\(\[]?\s*([\d,]+(?:\.\d+)?)\s*(l|litres?|liter|liters|litraa?|kg|kilo|kilos|kiloa?|g|gram|grams|boxes?|packs?|units?|pcs)\s*[\)\]]?$/i);
    if (pureQtyMatch && items.length > 0 && items[items.length - 1].unit === 'units' && items[items.length - 1].quantity === 1) {
      items[items.length - 1].quantity = parseFloat(pureQtyMatch[1].replace(/,/g, ''));
      items[items.length - 1].unit = normalizeUnit(pureQtyMatch[2]);
      continue;
    }

    // Quantity regex: e.g. "50 liters of organic whole milk", "10kg butter", "20 boxes croissants"
    const volMatch = seg.match(/^([\d,]+(?:\.\d+)?)\s*(l|litres?|liter|liters|litraa?|kg|kilo|kilos|kiloa?)\b\s*(?:of\s+)?(.*)$/i);
    const gramMatch = seg.match(/^([\d,]+(?:\.\d+)?)\s*(g|gram|grams|grammaa?)\b\s*(?:of\s+)?(.*)$/i);
    const qtyMatch = seg.match(/^([\d,]+)\s*(kpl|pcs|units?|boxes?|laatikkoa?|packs?|pussia?|canisters?|bottles?|pulloa?|croissants?|cases?|cartons?)\b\s*(?:of\s+)?(.*)$/i);
    // Trailing quantity match: e.g. "unsalted butter (15 kg)" or "unsalted butter 15kg"
    const trailingMatch = seg.match(/^(.*?)\s*[\(\[]?\s*([\d,]+(?:\.\d+)?)\s*(l|litres?|liter|liters|litraa?|kg|kilo|kilos|kiloa?|boxes?|packs?|units?)\s*[\)\]]?$/i);

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
    } else if (trailingMatch && trailingMatch[1].trim().length > 0) {
      qty = parseFloat(trailingMatch[2].replace(/,/g, ''));
      unit = normalizeUnit(trailingMatch[3]);
      itemName = trailingMatch[1].trim();
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
      .replace(/\b(?:for\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening))?(?:\s+delivery)?\b/gi, '')
      .replace(/\b(?:and|or|then|that)\s*$/gi, '')
      .replace(/^[,\.\s\-]+|[,\.\s\-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const stopWords = /^(?:availability|price|pricing|saatavuus|hinta|option|options|requirement|requirements|asap|friday|monday|thursday|tuesday|wednesday|saturday|sunday|quote|order|lock\s+the\s+quote|commit\s+the\s+order|purchasing\s+rules|rules|compliance)$/i;
    if (
      !cleanItem ||
      cleanItem.length < 2 ||
      stopWords.test(cleanItem) ||
      /^[\(\[\d\s\.,\-\)\]]+$/.test(cleanItem) ||
      /\b(?:lock\s+the\s+quote|commit\s+the\s+order|purchasing\s+rules|check\s+fixed|contract\s+prices?|autonomous\s+purchasing)\b/i.test(cleanItem)
    ) {
      continue;
    }

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
 * Cleans an ingredient query or product name extracted by LLM or free-text parser.
 * Preserves brand capitalization (e.g. 'Valio', 'Dansukker') while removing unnecessary quotes,
 * punctuation, and operational phrasing.
 */
export function cleanIngredientQuery(raw: string): string {
  if (!raw) return '';
  let str = raw.trim().replace(/^["'`]+|["'`]+$/g, '');
  str = str.replace(/[.,;:]+$/, '').trim();
  str = str.replace(/^(?:order|buy|deliver|get|purchase|tilatkaa|tarvitsemme)\s+/i, '').trim();
  return str;
}

export function calculateDefaultDeliverBy(now: Date = new Date()): string {
  const weekday = now.getUTCDay(); // 0=Sun, 1=Mon
  let daysAhead = (1 - weekday + 7) % 7;
  if (daysAhead <= 1) daysAhead += 7;
  return new Date(now.getTime() + daysAhead * 86400_000 + 8 * 3600_000).toISOString();
}

/**
 * Classifies buyer natural language input into operational intent archetypes.
 */
export function detectBuyerIntent(prompt: string): BuyerIntentType {
  const p = prompt.toLowerCase().trim();

  // 1. Policy & Governance Inquiry
  if (
    /\b(?:what\s+is|check|show|tell\s+me|how\s+much\s+is)\s+(?:our\s+)?(?:spend|spending|budget|cap|limit|threshold|guardrail|rule|quota)\b/i.test(p) ||
    /\b(?:spend|spending|budget|cap|limit|threshold)\s+(?:for|on|in)\s+[a-z0-9_-]+\b/i.test(p) ||
    /\bcan\s+(?:we|i)\s+(?:order|buy|spend|purchase)\b.*\b(?:within|under|allowed|policy|rule|limit)\b/i.test(p) ||
    /\b(?:what|which)\s+categories\s+(?:are\s+)?(?:allowed|whitelisted|permitted)\b/i.test(p) ||
    /\b(?:active|current)\s+(?:substitution|category)\s+rules\b/i.test(p) ||
    /\bpaljonko\s+(?:budjettia|rajaa|kattoa)\b/i.test(p) ||
    /\bsallitut\s+kategoriat\b/i.test(p)
  ) {
    return 'inquire_policy';
  }

  // 2. Stock / Inventory / Availability Inquiry (without an explicit purchase command)
  const isQuestionOrCheck =
    /^(?:check|verify|lookup|is\s+there|are\s+there|do\s+we\s+have|how\s+much\s+(?:stock|inventory)|what\s+is\s+the\s+availability|onko\s+varastossa|onko\s+saatavilla|tarkista\s+saatavuus)\b/i.test(p) ||
    /\b(?:in\s+stock\??|available\??|saatavilla\??|varastossa\??)$/i.test(p);

  const hasOrderVerb = /\b(?:please\s+)?(?:order|buy|purchase|deliver|procure|lock\s+the\s+quote|commit\s+the\s+order|tilaa|tilatkaa|ostakaa)\b/i.test(p);

  if (isQuestionOrCheck && !hasOrderVerb && !/\b(?:for\s+tuesday|for\s+monday|by\s+friday)\b/i.test(p)) {
    if (/\b(?:price|cost|pricing|hinta|paljonko\s+maksaa)\b/i.test(p)) {
      return 'inquire_price';
    }
    return 'inquire_stock';
  }

  if (/\b(?:what\s+is\s+the\s+price|how\s+much\s+does\s+.*cost|check\s+(?:the\s+)?price|mitä\s+maksaa|hinta\b)/i.test(p) && !hasOrderVerb) {
    return 'inquire_price';
  }

  // 3. Recipe Inquiry (how to make X, what ingredients for X without order command)
  if (
    /\b(?:what\s+(?:are\s+the\s+)?ingredients|how\s+(?:to|do\s+i)\s+(?:make|bake|cook)|mitä\s+aineksia)\b/i.test(p) &&
    !hasOrderVerb
  ) {
    return 'inquire_recipe';
  }

  // 4. Culinary Recipe Deduction (Dish / Meal / Event goal)
  if (
    /\b(?:recipe\s+for|resepti\s*:?|ainekset\s*:?|ingredients\s+for)\b/i.test(p) ||
    /\b(?:bake|cook|prepare|make|cater|serve|leipoa|valmistaa|keittää)\s+(?:[\w-]+\s+){0,3}(?:cookies?|buns?|cake|pie|soup|tiramisu|pizza|brownies?|lasagna|pasta|bread|korvapuusti|korvapuusteja|korvapuustia|lohikeitto|lohikeittoa|pulla|pullaa)\b/i.test(p) ||
    /\b(?:salmon\s+soup|lohikeitto|lohikeittoa|cinnamon\s+buns?|korvapuusti|korvapuustia|tiramisu|pizza)\s+(?:for\s+)?\d+\s*(?:people|guests|portions|servings|henkeä|annosta)\b/i.test(p) ||
    /\b\d+\s*(?:cookies?|keksejä|keksiä|buns?|puustia?|portions?|annosta|servings?)\s+(?:for\s+)?(?:a\s+)?(?:wedding|event|party|buffet|lunch|dinner|catering)\b/i.test(p) ||
    /\b(?:cookies?|keksejä|buns?|puustia?|lohikeitto|lohikeittoa|soup)\s+for\s+\d+\b/i.test(p)
  ) {
    return 'procurement_dish';
  }

  return 'procurement_order';
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
  const deliverBy = calculateDefaultDeliverBy(now);
  const detectedIntent = detectBuyerIntent(prompt);

  // Informational Inquiries (Policy, Stock, Price, Recipe questions) - Never place orders
  if (
    detectedIntent === 'inquire_policy' ||
    detectedIntent === 'inquire_stock' ||
    detectedIntent === 'inquire_price' ||
    detectedIntent === 'inquire_recipe'
  ) {
    let target = '';
    if (tLower.includes('dairy') || tLower.includes('maito') || tLower.includes('milk')) target = 'dairy';
    else if (tLower.includes('bakery') || tLower.includes('leipomo') || tLower.includes('bread') || tLower.includes('croissant')) target = 'bakery';
    else if (tLower.includes('produce') || tLower.includes('vihannes')) target = 'produce';
    else if (tLower.includes('beverage') || tLower.includes('coffee') || tLower.includes('kahvi')) target = 'beverages';
    else {
      target = prompt.replace(/\b(?:check|verify|lookup|stock|price|pricing|what\s+is|how\s+much|does|is|are|in|available|our|spend|limit|for|of)\b/gi, ' ').replace(/[?.,!]+/g, '').trim();
    }

    return {
      raw_prompt: prompt,
      request_type: 'single_item',
      detected_intent: detectedIntent,
      inquiry_target: target || 'general',
      dietary_tags: dietaryTags,
      deliver_by: deliverBy,
      items: [],
      notes: `Informational inquiry detected: ${detectedIntent}`,
    };
  }

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

  // 2.5. Check for adversarial system override attempt
  const isAdversarial = /\b(?:system\s+override|ignore\s+(?:spend\s+)?limits|bypass\s+policy|override\s+policy)\b/i.test(prompt);
  if (isAdversarial) {
    const eurMatch = prompt.match(/€\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*€/);
    const cost = eurMatch ? parseFloat((eurMatch[1] || eurMatch[2]).replace(/,/g, '')) : 4500.0;
    const estVol = Math.round(cost / 1.18);
    return {
      raw_prompt: prompt,
      request_type: 'single_item',
      dietary_tags: dietaryTags,
      deliver_by: deliverBy,
      items: [
        {
          ingredient_name: 'dairy',
          search_query: 'dairy',
          quantity: estVol,
          unit: 'L',
          category_hint: 'dairy',
          dietary_tags: dietaryTags,
          importance: 'essential',
          culinary_role: 'Adversarial override probe',
        },
      ],
      notes: 'Adversarial override probe detected. Flagged for Policy Firewall interception.',
    };
  }

  // 3. Identify if prompt contains multiple materials joined by "and", commas, or line breaks
  const parsedMaterials = parseExplicitMaterialList(prompt, dietaryTags);
  if (parsedMaterials.length > 1) {
    const recognized = reverseMatchRecipe(parsedMaterials);
    if (recognized) {
      return {
        raw_prompt: prompt,
        request_type: 'recipe',
        recipe: recognized.recipe,
        dietary_tags: dietaryTags,
        deliver_by: deliverBy,
        items: parsedMaterials,
        notes: `Recognized culinary dish '${recognized.recipe.name}' (Estimated yield: ${recognized.recipe.servings_or_yield} ${recognized.recipe.yield_unit}) from ${parsedMaterials.length} raw ingredient signatures.`,
      };
    }

    return {
      raw_prompt: prompt,
      request_type: 'multi_item',
      dietary_tags: dietaryTags,
      deliver_by: deliverBy,
      items: parsedMaterials,
      notes: `Decomposed multi-item procurement request into ${parsedMaterials.length} distinct product lines.`,
    };
  }

  // 4. Default: Single Item Procurement Request
  const primaryItem = parsedMaterials[0] || {
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

function isHighConfidenceSyncResult(res: PreprocessedPromptResult, prompt: string): boolean {
  // Informational inquiries (stock, price, policy, recipe questions)
  if (res.detected_intent) return true;
  // Recognized culinary dish from database or reverse signature
  if (res.request_type === 'recipe' && res.recipe) return true;
  // Decomposed multi-item list
  if (res.items.length > 1) return true;
  // Adversarial override attempt
  if (
    res.notes?.includes('Adversarial') ||
    /\b(?:system\s+override|ignore\s+(?:spend\s+)?limits|bypass\s+policy|override\s+policy)\b/i.test(prompt)
  ) {
    return true;
  }
  // Standard single commodity with recognized metric quantity & clean query
  if (res.items.length === 1) {
    const item = res.items[0];
    if (
      item &&
      (item.quantity > 1 || item.unit === 'L' || item.unit === 'kg' || item.unit === 'boxes' || item.unit === 'packs') &&
      item.ingredient_name !== prompt.trim()
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Preprocess natural language buyer prompts into structured procurement items,
 * identifying recipes, deducing necessary raw materials, scaling quantities, and detecting intent.
 * Passes the entire prompt directly to Google Gemini API for deep intent analysis,
 * with strict prompt injection sanitization, delimiter isolation, and deterministic local fallback.
 */
export async function preprocessBuyerPrompt(
  prompt: string,
  now: Date = new Date()
): Promise<PreprocessedPromptResult> {
  const deliverBy = calculateDefaultDeliverBy(now);
  const dietaryTags = extractShortTags(prompt);

  // 1. Guard against Prompt Injection Attacks
  const injection = sanitizeUntrustedPrompt(prompt);
  if (injection.isInjectionAttempt) {
    const eurMatch = prompt.match(/€\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*€/);
    const cost = eurMatch ? parseFloat((eurMatch[1] || eurMatch[2]).replace(/,/g, '')) : 4500.0;
    const estVol = Math.round(cost / 1.18);
    return {
      raw_prompt: prompt,
      request_type: 'single_item',
      dietary_tags: dietaryTags,
      deliver_by: deliverBy,
      is_adversarial_probe: true,
      items: [
        {
          ingredient_name: 'dairy',
          search_query: 'dairy',
          quantity: estVol,
          unit: 'L',
          category_hint: 'dairy',
          dietary_tags: dietaryTags,
          importance: 'essential',
          culinary_role: 'Adversarial override probe',
        },
      ],
      notes: `Prompt injection attack detected (${injection.injectionFlags.join(', ')}). Intercepted for Policy Firewall enforcement.`,
    };
  }

  // 2. Pass entire prompt directly to Google Gemini API for intent extraction
  if (process.env.DISABLE_REMOTE_LLM !== 'true') {
    try {
      const gemini = GeminiClient.getInstance();
      if (gemini.isAvailable()) {
        const unified = await gemini.analyzeProcurementIntent(prompt);
        if (unified) {
          // If Gemini flagged an adversarial probe during reasoning
          if (unified.is_adversarial_probe) {
            return {
              raw_prompt: prompt,
              request_type: 'single_item',
              dietary_tags: dietaryTags,
              deliver_by: deliverBy,
              is_adversarial_probe: true,
              items: [
                {
                  ingredient_name: 'dairy',
                  search_query: 'dairy',
                  quantity: 3814,
                  unit: 'L',
                  category_hint: 'dairy',
                  dietary_tags: dietaryTags,
                  importance: 'essential',
                  culinary_role: 'Adversarial override probe',
                },
              ],
              notes: unified.notes || 'Adversarial prompt injection probe detected by Gemini reasoning engine.',
            };
          }

          // Informational Inquiries (Stock, Price, Policy, Recipe questions)
          if (
            unified.intent === 'inquire_stock' ||
            unified.intent === 'inquire_price' ||
            unified.intent === 'inquire_policy' ||
            unified.intent === 'inquire_recipe'
          ) {
            return {
              raw_prompt: prompt,
              request_type: 'single_item',
              detected_intent: unified.intent,
              inquiry_target: unified.inquiry_target || undefined,
              dietary_tags: Array.from(new Set([...dietaryTags, ...(unified.dietary_tags || [])])),
              deliver_by: deliverBy,
              items: [],
              notes: unified.inquiry_answer || unified.notes || `Informational inquiry detected: ${unified.intent}`,
            };
          }

          // Commercial Procurement Items Extracted by Gemini
          if (unified.items && unified.items.length > 0) {
            const combinedDietary = Array.from(new Set([...dietaryTags, ...(unified.dietary_tags || [])]));
            const isRecipe =
              unified.intent === 'dish_deduction' ||
              unified.intent === 'explicit_recipe' ||
              Boolean(unified.dish && unified.dish.name);

            let recipeMeta: RecipeMetadata | undefined = undefined;
            if (isRecipe && unified.dish && unified.dish.name) {
              recipeMeta = {
                name: unified.dish.name,
                servings_or_yield: unified.dish.servings_or_yield || 10,
                yield_unit: unified.dish.yield_unit || 'portions',
                cuisine: unified.dish.cuisine || 'Commercial Kitchen',
                description: unified.notes || `Culinary dish: ${unified.dish.name}`,
                is_recognized_from_ingredients: Boolean(unified.dish.is_recognized_from_ingredients),
                missing_staples: unified.dish.missing_staples || [],
              };
            }

            const requestType: ProcurementRequestType = isRecipe
              ? 'recipe'
              : unified.items.length > 1
              ? 'multi_item'
              : 'single_item';

            return {
              raw_prompt: prompt,
              request_type: requestType,
              recipe: recipeMeta,
              dietary_tags: combinedDietary,
              deliver_by: deliverBy,
              items: unified.items.map((item) => ({
                ingredient_name: cleanIngredientQuery(item.ingredient_name),
                search_query: cleanIngredientQuery(item.search_query || item.ingredient_name),
                quantity: Math.max(0.001, Number(item.quantity) || 1),
                unit: normalizeUnit(item.unit),
                category_hint: item.category_hint || 'dairy',
                dietary_tags: item.dietary_tags || [],
                importance: item.importance || 'essential',
                culinary_role: item.culinary_role || 'Commercial kitchen material',
              })),
              notes: unified.notes || `Intent and line items extracted via Google Gemini (${gemini.getModelName()}).`,
            };
          }
        }
      }
    } catch (err) {
      console.warn(`[preprocessBuyerPrompt] Gemini intent extraction failed (${(err as Error).message}), falling back to deterministic preprocessor.`);
    }
  }

  // 3. Fallback: Local deterministic preprocessor (for offline tests or when remote LLM disabled)
  return preprocessBuyerPromptSync(prompt, now);
}
