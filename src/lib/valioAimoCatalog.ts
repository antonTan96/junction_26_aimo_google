import fs from 'node:fs';
import path from 'node:path';
import type { PublicOfferDTO } from '../types/aimogate.ts';

export interface CatalogProduct {
  id: string;
  gtin: string;
  name_fi: string;
  name_en: string;
  name_sv: string;
  display_name: string;
  vendor_name: string;
  brand: string;
  category: string; // 'dairy' | 'plant-based' | 'bakery' | 'beverages' | 'cleaning' | 'meat' | 'alcohol' | 'general'
  dietary_tags: string[];
  pack_format: string;
  pack_volume_litres: number;
  temperature_condition: number;
  search_corpus: string;
  is_active: boolean;
  base_price_eur?: number;
}

const UPSTREAM_API_BASE = process.env.VALIO_API_BASE_URL || 'https://junction26.valioaimo.fi';
const UPSTREAM_API_KEY =
  process.env.VALIO_API_KEY ||
  process.env.WEB_API_KEY ||
  'junct_tDnQn4VI_nfhELGCOEkY4vbuxm324MmYmILuokYG03Y';

export class ValioAimoCatalogService {
  private static instance: ValioAimoCatalogService | null = null;
  private products: CatalogProduct[] = [];
  private productMap = new Map<string, CatalogProduct>();
  private isLoaded = false;

  public static getInstance(): ValioAimoCatalogService {
    if (!ValioAimoCatalogService.instance) {
      ValioAimoCatalogService.instance = new ValioAimoCatalogService();
    }
    return ValioAimoCatalogService.instance;
  }

  private resolveCatalogPath(): string | null {
    if (typeof window !== 'undefined' || typeof fs?.existsSync !== 'function') {
      return null;
    }
    const candidatePaths = [
      process.env.VALIO_CATALOG_PATH,
      path.resolve(process.cwd(), 'data/valio_catalog_17546.json'),
      path.resolve(process.cwd(), '../junction26_aimo/valio_aimo_junction26_product_data.json'),
      path.resolve(process.cwd(), 'valio_aimo_junction26_product_data.json'),
      '/home/anton/junction26/junction26_aimo/valio_aimo_junction26_product_data.json',
    ].filter(Boolean) as string[];

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        // ignore
      }
    }
    return null;
  }

  public ensureLoaded(): void {
    if (this.isLoaded) return;
    const catalogFile = this.resolveCatalogPath();

    if (!catalogFile) {
      this.loadBuiltinCatalog();
      this.isLoaded = true;
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
      if (!Array.isArray(raw)) {
        this.loadBuiltinCatalog();
        this.isLoaded = true;
        return;
      }

      this.products = [];
      this.productMap.clear();

      // Fast-path: if pre-processed CatalogProduct array
      if (raw.length > 0 && raw[0].display_name && raw[0].search_corpus) {
        this.products = raw;
        for (const item of this.products) {
          this.productMap.set(item.id, item);
        }
        this.isLoaded = true;
        return;
      }

      for (const p of raw) {
        if (p.deleted) continue;
        const synkka = p.synkkaData || {};
        const names = synkka.names || [];
        const fiName = names.find((n: any) => n.language === 'fi')?.value || `Tuote ${p.id}`;
        const enName = names.find((n: any) => n.language === 'en')?.value || fiName;
        const svName = names.find((n: any) => n.language === 'sv')?.value || fiName;
        const displayName = enName || fiName;

        const tags: string[] = [];
        synkka.classifications?.forEach((c: any) =>
          c.values?.forEach((v: any) => {
            if (v.id) tags.push(v.id.toLowerCase());
          })
        );

        const lowerAll = `${displayName} ${fiName}`.toLowerCase();
        if (tags.includes('free_from_lactose') || lowerAll.includes('lactose free') || lowerAll.includes('laktoositon')) {
          tags.push('lactose-free');
        }
        if (tags.includes('free_from_gluten') || lowerAll.includes('gluten free') || lowerAll.includes('gluteeniton')) {
          tags.push('gluten-free');
        }
        if (tags.includes('vegan') || lowerAll.includes('vegan') || lowerAll.includes('vegaani')) {
          tags.push('vegan');
        }
        if (tags.includes('vegetarian') || lowerAll.includes('kasvis')) {
          tags.push('vegetarian');
        }

        // Derive pack volume in litres or kg
        let vol = 1.0;
        const unitConversions = synkka.unitConversions || [];
        for (const uc of unitConversions) {
          if (uc.volume && uc.volume.value) {
            vol = parseFloat(uc.volume.value);
            break;
          } else if (uc.netWeight && uc.netWeight.value) {
            vol = parseFloat(uc.netWeight.value);
            break;
          }
        }
        if (isNaN(vol) || vol <= 0) vol = 1.0;

        // Determine Category
        const category = this.categorizeProduct(displayName, fiName, tags, p.vendorName || '');

        // Pack format formatting
        let packFormat = p.salesUnit || 'PCE';
        const lowerName = displayName.toLowerCase();
        if (lowerName.includes('10 l') || lowerName.includes('10l')) packFormat = '10L Bag-in-Box';
        else if (lowerName.includes('12x1l') || lowerName.includes('12 x 1l')) packFormat = '12x1L Carton';
        else if (lowerName.includes('5 l') || lowerName.includes('5l')) packFormat = '5L Canister';
        else if (lowerName.includes('1 l') || lowerName.includes('1l')) packFormat = '1L Carton';
        else if (lowerName.includes('500 g') || lowerName.includes('500g')) packFormat = '500g Pack';
        else if (vol > 1) packFormat = `${vol}L Unit`;

        const corpus = `${displayName} ${fiName} ${svName} ${p.vendorName || ''} ${synkka.brand || ''} ${tags.join(' ')}`.toLowerCase();

        const item: CatalogProduct = {
          id: String(p.id),
          gtin: p.salesUnitGtin || synkka.gtin || '',
          name_fi: fiName,
          name_en: enName,
          name_sv: svName,
          display_name: displayName,
          vendor_name: p.vendorName || 'Valio Aimo',
          brand: synkka.brand || 'Valio',
          category,
          dietary_tags: tags,
          pack_format: packFormat,
          pack_volume_litres: Number(vol.toFixed(3)),
          temperature_condition: p.temperatureCondition || 4,
          search_corpus: corpus,
          is_active: !p.deleted,
        };

        this.products.push(item);
        this.productMap.set(item.id, item);
      }

      this.isLoaded = true;
    } catch (err) {
      console.warn('Could not load full Valio Aimo catalog JSON, falling back to built-in staple list:', err);
      this.loadBuiltinCatalog();
      this.isLoaded = true;
    }
  }

  private categorizeProduct(nameEn: string, nameFi: string, tags: string[], vendor: string): string {
    const text = `${nameEn} ${nameFi} ${vendor}`.toLowerCase();
    const isVegan = tags.includes('vegan') || tags.includes('plant_based') || text.includes('oddlygood') || text.includes('kaura');

    if (isVegan && (text.includes('kaura') || text.includes('oat') || text.includes('soija') || text.includes('barista') || text.includes('vegaani'))) {
      return 'plant-based';
    }
    if (
      text.includes('maito') ||
      text.includes('milk') ||
      text.includes('kerma') ||
      text.includes('cream') ||
      text.includes('juusto') ||
      text.includes('cheese') ||
      text.includes('voi') ||
      text.includes('butter') ||
      text.includes('jogurtti') ||
      text.includes('yogurt') ||
      text.includes('rahka') ||
      text.includes('viili')
    ) {
      return 'dairy';
    }
    if (
      text.includes('leipä') ||
      text.includes('bread') ||
      text.includes('croissant') ||
      text.includes('sämpylä') ||
      text.includes('kakku') ||
      text.includes('pulla') ||
      text.includes('piirakka') ||
      text.includes('bakery') ||
      text.includes('pastry')
    ) {
      return 'bakery';
    }
    if (
      text.includes('kahvi') ||
      text.includes('coffee') ||
      text.includes('mehu') ||
      text.includes('juice') ||
      text.includes('tee') ||
      text.includes('tea') ||
      text.includes('juoma') ||
      text.includes('beverage') ||
      text.includes('paulig')
    ) {
      return 'beverages';
    }
    if (
      text.includes('pesu') ||
      text.includes('hygienia') ||
      text.includes('hygiene') ||
      text.includes('puhdistus') ||
      text.includes('sanitizer') ||
      text.includes('clean') ||
      text.includes('saippua') ||
      text.includes('detergent')
    ) {
      return 'cleaning';
    }
    if (
      text.includes('liha') ||
      text.includes('meat') ||
      text.includes('kana') ||
      text.includes('chicken') ||
      text.includes('broileri') ||
      text.includes('nauta') ||
      text.includes('beef') ||
      text.includes('possu') ||
      text.includes('pork') ||
      text.includes('makkara') ||
      text.includes('atria') ||
      text.includes('hkscan')
    ) {
      return 'meat';
    }
    if (
      text.includes('viini') ||
      text.includes('wine') ||
      text.includes('olut') ||
      text.includes('beer') ||
      text.includes('siideri') ||
      text.includes('cider') ||
      text.includes('alko')
    ) {
      return 'alcohol';
    }

    return 'dairy'; // default pantry staple
  }

  private loadBuiltinCatalog(): void {
    const staples: Array<Partial<CatalogProduct>> = [
      {
        id: 'VA-LF-MILK-10L',
        display_name: 'Valio Eila® Lactose-Free Semi-Skimmed Milk',
        name_fi: 'Valio Eila® Laktoositon Kevytmaito 10L',
        name_en: 'Valio Eila® Lactose-Free Semi-Skimmed Milk',
        brand: 'Valio Eila',
        category: 'dairy',
        dietary_tags: ['lactose-free'],
        pack_format: '10L Bag-in-Box',
        pack_volume_litres: 10.0,
      },
      {
        id: 'VA-LF-MILK-12X1L',
        display_name: 'Valio Eila® Lactose-Free Milk UHT 12x1L',
        name_fi: 'Valio Eila® Laktoositon Maito UHT 12x1L',
        name_en: 'Valio Eila® Lactose-Free Milk UHT 12x1L',
        brand: 'Valio Eila',
        category: 'dairy',
        dietary_tags: ['lactose-free'],
        pack_format: '12x1L Carton',
        pack_volume_litres: 12.0,
      },
      {
        id: 'VA-OAT-BARISTA-10L',
        display_name: 'Valio Oddlygood® Barista Oat Drink 10L',
        name_fi: 'Valio Oddlygood® Barista Kaurajuoma 10L',
        name_en: 'Valio Oddlygood® Barista Oat Drink 10L',
        brand: 'Valio Oddlygood',
        category: 'plant-based',
        dietary_tags: ['lactose-free', 'vegan', 'plant-based'],
        pack_format: '10L Bag-in-Box',
        pack_volume_litres: 10.0,
      },
      {
        id: 'VA-BAKERY-CROISSANT-50',
        display_name: 'Valio Artisanal Butter Croissant (50pk)',
        name_fi: 'Valio Voicroissant 50x65g',
        name_en: 'Valio Artisanal Butter Croissant (50pk)',
        brand: 'Valio Bakery',
        category: 'bakery',
        dietary_tags: ['vegetarian'],
        pack_format: '50x65g Case',
        pack_volume_litres: 3.25,
      },
      {
        id: 'VA-CLEAN-HYGIENE-5L',
        display_name: 'Valio Pro Hygiene Food-Contact Sanitizer 5L',
        name_fi: 'Valio Pro Hygiene Pintadesinfektio 5L',
        name_en: 'Valio Pro Hygiene Food-Contact Sanitizer 5L',
        brand: 'Valio Pro',
        category: 'cleaning',
        dietary_tags: [],
        pack_format: '5L Canister',
        pack_volume_litres: 5.0,
      },
      {
        id: 'VA-BUTTER-500G',
        display_name: 'Valio Traditional Cooking Butter 500g',
        name_fi: 'Valio Meijerivoi Perinteinen 500g',
        name_en: 'Valio Traditional Cooking Butter 500g',
        brand: 'Valio Voi',
        category: 'dairy',
        dietary_tags: ['vegetarian'],
        pack_format: '500g Block',
        pack_volume_litres: 0.5,
      },
      {
        id: 'VA-CHEESE-OLTERMANNI',
        display_name: 'Valio Oltermanni® Mild Cream Cheese 1kg',
        name_fi: 'Valio Oltermanni® Kermajuusto 1kg',
        name_en: 'Valio Oltermanni® Mild Cream Cheese 1kg',
        brand: 'Valio Oltermanni',
        category: 'dairy',
        dietary_tags: ['lactose-free', 'vegetarian'],
        pack_format: '1kg Block',
        pack_volume_litres: 1.0,
      },
      {
        id: 'VA-COFFEE-PAULIG-1KG',
        display_name: 'Paulig Professional Espresso Coffee Beans 1kg',
        name_fi: 'Paulig Espresso Pavut 1kg',
        name_en: 'Paulig Professional Espresso Coffee Beans 1kg',
        brand: 'Paulig',
        category: 'beverages',
        dietary_tags: ['vegan'],
        pack_format: '1kg Bag',
        pack_volume_litres: 1.0,
      },
    ];

    this.products = staples.map((s) => {
      const corpus = `${s.display_name} ${s.name_fi} ${s.name_en} ${s.brand} ${(s.dietary_tags || []).join(' ')}`.toLowerCase();
      return {
        id: s.id!,
        gtin: '640946000000',
        name_fi: s.name_fi!,
        name_en: s.name_en!,
        name_sv: s.name_en!,
        display_name: s.display_name!,
        vendor_name: 'Valio Aimo',
        brand: s.brand || 'Valio',
        category: s.category || 'dairy',
        dietary_tags: s.dietary_tags || [],
        pack_format: s.pack_format || 'PCE',
        pack_volume_litres: s.pack_volume_litres || 1.0,
        temperature_condition: 4,
        search_corpus: corpus,
        is_active: true,
      };
    });

    for (const p of this.products) {
      this.productMap.set(p.id, p);
    }
  }

  public getProductCount(): number {
    this.ensureLoaded();
    return this.products.length;
  }

  public search(
    query: string,
    options?: {
      category?: string;
      tags?: string[];
      limit?: number;
    }
  ): CatalogProduct[] {
    this.ensureLoaded();
    const cleanQ = (query || '').toLowerCase().replace(/[-_]/g, ' ').trim();
    const rawWords = cleanQ.split(/\s+/).filter(Boolean);
    const STOPWORDS = new Set(['of', 'the', 'a', 'an', 'for', 'in', 'to', 'and', 'with', 'by', 'our', 'we', 'need', 'please', 'order', 'some', 'per', 'on', 'at']);
    const meaningfulWords = rawWords.filter((w) => !STOPWORDS.has(w) && w.length > 1);
    const words = meaningfulWords.length > 0 ? meaningfulWords : rawWords;

    const SYNONYMS: Record<string, string[]> = {
      butter: ['voi', 'meijerivoi'],
      milk: ['maito', 'kevytmaito', 'täysmaito'],
      cheese: ['juusto', 'kermajuusto'],
      cream: ['kerma', 'kuohukerma'],
      coffee: ['kahvi', 'espresso'],
      oat: ['kaura', 'kaurajuoma', 'oddlygood'],
      bread: ['leipä', 'sämpylä'],
      croissant: ['croissant', 'voicroissant'],
    };

    const expandedWords = new Set<string>(words);
    for (const w of words) {
      if (SYNONYMS[w]) {
        for (const s of SYNONYMS[w]) expandedWords.add(s);
      }
    }

    const category = options?.category?.toLowerCase();
    const reqTags = (options?.tags || []).map((t) => t.toLowerCase());
    const limit = options?.limit || 25;

    const scored: Array<{ product: CatalogProduct; score: number }> = [];

    for (const p of this.products) {
      if (!p.is_active) continue;
      if (category && category !== 'all' && p.category !== category) continue;
      if (reqTags.length > 0 && !reqTags.every((t) => p.dietary_tags.includes(t))) continue;

      let score = 0;
      let matchedCount = 0;
      const lowerDisplay = p.display_name.toLowerCase();
      const lowerBrand = p.brand.toLowerCase();
      const normalizedCorpus = p.search_corpus.replace(/[-_]/g, ' ');

      if (words.length === 0) {
        score = 1;
      } else {
        for (const w of words) {
          const syns = SYNONYMS[w] || [];
          const matchesTerm = (term: string) => {
            if (term.length <= 3) {
              return new RegExp(`\\b${term}\\b`, 'i').test(normalizedCorpus);
            }
            return normalizedCorpus.includes(term);
          };
          const matchesDisplay = (term: string) => {
            if (term.length <= 3) {
              return new RegExp(`\\b${term}\\b`, 'i').test(lowerDisplay);
            }
            return lowerDisplay.includes(term);
          };

          const matched = matchesTerm(w) || syns.some((s) => matchesTerm(s));

          if (matched) {
            matchedCount++;
            score += 25;
            if (matchesDisplay(w) || syns.some((s) => matchesDisplay(s))) score += 50;
            if (lowerBrand.includes(w)) score += 30;
            if (p.id.toLowerCase() === w) score += 250;
          }
        }

        // Require at least 1 meaningful word match
        if (matchedCount === 0) continue;

        // Bonus for matching all search words
        if (matchedCount === words.length) {
          score += 80;
        }

        // Exact multi-word phrase bonus
        if (cleanQ.length > 3 && (lowerDisplay.includes(cleanQ) || normalizedCorpus.includes(cleanQ))) {
          score += 150;
        }

        // Staple brand bonus
        if (lowerBrand.includes('valio') || lowerBrand.includes('oddlygood') || lowerBrand.includes('paulig')) {
          score += 25;
        }

        // Penalty for non-food tools / vegetables when searching butter
        if (words.includes('butter')) {
          if (lowerDisplay.includes('spreader') || lowerDisplay.includes('squash') || lowerDisplay.includes('pumpkin')) {
            score -= 100;
          }
          if (lowerDisplay.includes('voi') || lowerDisplay.includes('butter') || lowerBrand.includes('valio')) {
            score += 50;
          }
        }

        // Liquid milk priority when searching for milk
        if (words.includes('milk') || words.includes('maito')) {
          if (lowerDisplay.includes('chocolate') || lowerDisplay.includes('suklaa') || lowerDisplay.includes('patukka')) {
            score -= 60;
          }
          if (lowerDisplay.includes('skimmed') || lowerDisplay.includes('kevytmaito') || lowerDisplay.includes('täysmaito') || lowerDisplay.includes('10l') || lowerDisplay.includes('1l')) {
            score += 80;
          }
        }
      }

      if (score > 0) {
        scored.push({ product: p, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.product);
  }

  public getProductById(id: string): CatalogProduct | null {
    this.ensureLoaded();
    return this.productMap.get(id) || null;
  }

  // --- Upstream Live API Queries (junction26.valioaimo.fi) ---

  public async fetchLivePrices(productIds: string[], requestedDate: string = '2026-11-16', customer: string = '123'): Promise<Map<string, { catalogPrice: number; compPrice: number; compUnit: string }>> {
    const results = new Map<string, { catalogPrice: number; compPrice: number; compUnit: string }>();
    if (productIds.length === 0) return results;

    try {
      const res = await fetch(`${UPSTREAM_API_BASE}/api/price`, {
        method: 'POST',
        headers: {
          'X-API-Key': UPSTREAM_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer,
          requestedDate,
          products: productIds.slice(0, 50),
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        for (const p of data.products || []) {
          if (!p.error) {
            results.set(p.productId, {
              catalogPrice: Number(p.catalogPrice?.value ?? p.listPrice?.value ?? 10.0),
              compPrice: Number(p.comparisonPrice?.value ?? 1.2),
              compUnit: String(p.comparisonUnit || 'L'),
            });
          }
        }
      }
    } catch (err) {
      console.warn('Live price fetch warning (using synthetic defaults):', err);
    }

    return results;
  }

  public async fetchLiveAvailability(productIds: string[], requestedDate: string = '2026-11-16', customer: string = '123'): Promise<Map<string, { isAvailable: boolean; availablePacks: number; closingTime?: string }>> {
    const results = new Map<string, { isAvailable: boolean; availablePacks: number; closingTime?: string }>();
    if (productIds.length === 0) return results;

    try {
      const res = await fetch(`${UPSTREAM_API_BASE}/api/availability`, {
        method: 'POST',
        headers: {
          'X-API-Key': UPSTREAM_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer,
          requestedDate,
          products: productIds.slice(0, 50),
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        for (const p of data.products || []) {
          const isBlocked = Boolean(p.salesBlock);
          let packs = 1000;
          if (p.scheduleLines && p.scheduleLines[0]) {
            packs = Number(p.scheduleLines[0].availableAmount || 1000);
            if (packs > 99999) packs = 999;
          }
          results.set(p.productId, {
            isAvailable: !isBlocked && packs > 0,
            availablePacks: packs,
            closingTime: p.closingTime,
          });
        }
      }
    } catch (err) {
      console.warn('Live availability fetch warning (using synthetic defaults):', err);
    }

    return results;
  }
}
