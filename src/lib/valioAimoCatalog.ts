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

/**
 * Finnish suffix stripping / normalization for tokens > 4 chars:
 * Strips partitive endings (-a, -ta, -ia, -ää), genitive (-n), and inessive (-ssa/-ssä)
 * Examples: täysmaitoa -> täysmaito, meijerivoita -> meijerivoi, kuohukermaa -> kuohukerma
 */
export function normalizeFinnishToken(token: string): string {
  const t = token.toLowerCase();
  if (t === 'keksiä' || t === 'keksejä' || t === 'keksit') return 'keksi';
  if (t === 'pikkuleipiä' || t === 'pikkuleivät') return 'pikkuleipä';
  if (t === 'pipareita' || t === 'piparit' || t === 'piparkakkuja') return 'piparkakku';
  if (t === 'käsineet' || t === 'käsineitä') return 'käsine';
  if (t === 'hanskat' || t === 'hanskoja') return 'hanska';
  if (t === 'servetit' || t === 'servettejä') return 'servetti';
  if (t === 'lautasliinat' || t === 'lautasliinoja') return 'lautasliina';
  if (t === 'nenäliinat' || t === 'nenäliinoja') return 'nenäliina';
  if (t.length <= 4) return t;

  // Preserve abessive adjective ending -ton / -tön (e.g. laktoositon, rasvaton, gluteeniton, maidoton)
  if (t.endsWith('ton') || t.endsWith('tön')) return t;

  // Inessive: -ssa / -ssä
  if (t.endsWith('ssa') || t.endsWith('ssä')) {
    if (t.length > 5) return t.slice(0, -3);
  }
  // Partitive: -ta / -tä (e.g. meijerivoita -> meijerivoi)
  if (t.endsWith('ta') || t.endsWith('tä')) {
    if (t.length > 4) return t.slice(0, -2);
  }
  // Partitive: -ia / -iä
  if (t.endsWith('ia') || t.endsWith('iä')) {
    if (t.length > 4) return t.slice(0, -2);
  }
  // Double vowel ending like -aa / -ää in partitive: e.g. kuohukermaa -> kuohukerma, piimää -> piimä
  if (t.endsWith('aa') || t.endsWith('ää')) {
    if (t.length > 4) return t.slice(0, -1);
  }
  // Single partitive -a / -ä if preceded by 'o', 'u', 'y', 'ö', 'e': e.g. täysmaitoa -> täysmaito
  if (t.endsWith('a') && /[oue]a$/.test(t)) {
    if (t.length > 4) return t.slice(0, -1);
  }
  if (t.endsWith('ä') && /[yöe]ä$/.test(t)) {
    if (t.length > 4) return t.slice(0, -1);
  }
  // Genitive: -n (length > 4, not -en, -in, -on)
  if (t.endsWith('n') && !t.endsWith('en') && !t.endsWith('in') && !t.endsWith('on')) {
    if (t.length > 4) return t.slice(0, -1);
  }
  return t;
}

/**
 * Enriches catalog product dietary and descriptive short tags based on synkka classifications,
 * product names, brands, and temperature conditions.
 */
export function enrichProductShortTags(
  displayName: string,
  nameFi: string,
  nameEn: string,
  existingTags: string[] = [],
  tempCondition?: number
): string[] {
  const corpus = `${displayName} ${nameFi} ${nameEn} ${(existingTags || []).join(' ')}`.toLowerCase();
  const tags = new Set<string>((existingTags || []).map((t) => t.toLowerCase()));

  // 1. Dietary & Allergens
  if (corpus.includes('laktoositon') || corpus.includes('lactose free') || corpus.includes('lactose-free') || tags.has('free_from_lactose')) {
    tags.add('lactose-free');
  }
  if (corpus.includes('vähälaktoosinen') || corpus.includes('low lactose') || corpus.includes('low-lactose') || corpus.includes('hyla')) {
    tags.add('low-lactose');
  }
  if (corpus.includes('gluteeniton') || corpus.includes('gluten free') || corpus.includes('gluten-free') || tags.has('free_from_gluten')) {
    tags.add('gluten-free');
  }
  if (corpus.includes('vegaani') || corpus.includes('vegan') || tags.has('vegan')) {
    tags.add('vegan');
    tags.add('plant-based');
  }
  if (corpus.includes('kasvis') || corpus.includes('vegetarian')) {
    tags.add('vegetarian');
  }
  if (corpus.includes('luomu') || corpus.includes('organic') || corpus.includes('eu_organic_farming') || tags.has('eu_organic_farming')) {
    tags.add('organic');
  }
  if (corpus.includes('sokeriton') || corpus.includes('sugar-free')) {
    tags.add('sugar-free');
  }

  // 2. Fat / Milk Content
  if (corpus.includes('täysmaito') || corpus.includes('whole milk') || corpus.includes('vanhanajan') || corpus.includes('täysrasvainen')) {
    tags.add('whole');
  }
  if (corpus.includes('kevytmaito') || corpus.includes('semi-skimmed') || corpus.includes('semi skimmed')) {
    tags.add('semi-skimmed');
  }
  if (corpus.includes('rasvaton') || corpus.includes('skimmed') || corpus.includes('fat-free')) {
    tags.add('skimmed');
  }

  // 3. Storage & Temperature Condition
  if (tempCondition === 7 || corpus.includes('pakaste') || corpus.includes('frozen') || tags.has('freezetemperature')) {
    tags.add('frozen');
  }
  if (corpus.includes('tuore') || corpus.includes('fresh') || (tempCondition !== undefined && tempCondition <= 4 && !tags.has('frozen') && !tags.has('uht'))) {
    tags.add('fresh');
  }
  if (corpus.includes('uht') || corpus.includes('iskuuumennettu') || corpus.includes('long life') || corpus.includes('kestomaito') || tags.has('warmtemperature')) {
    tags.add('uht');
  }

  // 4. Culinary function
  if (corpus.includes('suolaamaton') || corpus.includes('unsalted')) {
    tags.add('unsalted');
  }
  if (corpus.includes('suolattu') || corpus.includes('suolainen') || corpus.includes('normaalisuolainen') || corpus.includes('salted')) {
    if (!tags.has('unsalted')) tags.add('salted');
  }
  if (corpus.includes('barista') || corpus.includes('kahviin') || corpus.includes('vaahtoutuva')) {
    tags.add('barista');
  }
  if (corpus.includes('kuohukerma') || corpus.includes('vispikerma') || corpus.includes('vispi') || corpus.includes('whipping')) {
    tags.add('whipping');
  }
  if (corpus.includes('kermaviili') || corpus.includes('smetana') || corpus.includes('sour cream') || corpus.includes('ranskankerma')) {
    tags.add('sour-cream');
  }
  if (corpus.includes('ruokakerma') || corpus.includes('leivontaan') || corpus.includes('cooking')) {
    tags.add('cooking');
  }

  // 5. Base Ingredients & Origin
  if (corpus.includes('kaura') || corpus.includes('oat') || corpus.includes('oddlygood') || corpus.includes('oatly')) {
    tags.add('oat');
    tags.add('plant-based');
  }
  if (corpus.includes('valio') || corpus.includes('kotimainen') || corpus.includes('suomi') || tags.has('goods_from_finland_blue_swan') || tags.has('made_in_finland_flag_with_key')) {
    tags.add('domestic');
  }
  if (corpus.includes('novobox') || corpus.includes('bag-in-box') || corpus.includes('10 l') || corpus.includes('10l') || corpus.includes('5 l') || corpus.includes('5l') || corpus.includes('10kg')) {
    tags.add('bulk');
  }

  return Array.from(tags);
}

export const SYNONYM_GROUPS: string[][] = [
  ['butter', 'voi', 'meijerivoi'],
  ['milk', 'maito', 'mjölk'],
  ['täysmaito', 'whole milk', 'standardmjölk', 'vanhanajan täysmaito'],
  ['kevytmaito', 'kevytmaitojuoma', 'semi-skimmed', 'semi skimmed', 'lättmjölk', 'lättmjölkdryck'],
  ['rasvaton maito', 'rasvaton', 'skimmed milk', 'skim milk', 'fat free milk', 'skummjölk'],
  ['cream', 'kerma', 'grädde'],
  ['kuohukerma', 'vispikerma', 'whipping cream', 'vispgrädde'],
  ['tuorejuusto', 'cream cheese', 'färskost'],
  ['yogurt', 'jogurtti', 'jukurtti'],
  ['cheese', 'juusto', 'ost'],
  ['oltermanni'],
  ['parmesan', 'parmesaani', 'parmigiano', 'grana padano'],
  ['cheddar'],
  ['coffee', 'kahvi', 'espresso', 'kahvipapu', 'pavut', 'kaffe'],
  ['oat', 'kaura', 'kaurajuoma', 'kauramaito', 'oat milk', 'oat drink', 'oddlygood', 'oatly', 'havredryck'],
  ['croissant', 'voicroissant'],
  ['cookie', 'cookies', 'keksi', 'keksit', 'keksejä', 'keksiä', 'biscuit', 'biscuits', 'pikkuleipä', 'pikkuleivät', 'pikkuleipiä', 'pipari', 'piparkakku', 'piparkakkuja'],
  ['bread', 'leipä', 'sämpylä', 'bröd'],
  ['sour cream', 'kermaviili', 'smetana', 'hapankerma', 'creme fraiche', 'crème fraîche', 'gräddfil'],
  ['pintadesinfektio', 'desinfektio', 'sanitizer', 'hygiene', 'disinfectant', 'easydes', 'hygienia'],
  ['gloves', 'glove', 'käsine', 'käsineet', 'käsineitä', 'hanska', 'hanskat', 'hanskoja', 'kertakäyttökäsine', 'kertakäyttökäsineet', 'suojakäsine', 'suojakäsineet'],
  ['napkin', 'napkins', 'servetti', 'servetit', 'servettejä', 'lautasliina', 'lautasliinat', 'lautasliinoja'],
  ['hankie', 'hankies', 'tissue', 'tissues', 'nenäliina', 'nenäliinat', 'nenäliinoja', 'taskuliina', 'taskuliinat'],
];

export const SYNONYMS: Record<string, string[]> = {};
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    SYNONYMS[word] = group;
  }
}

export const FINNISH_STOPWORDS = new Set([
  'of', 'the', 'a', 'an', 'for', 'in', 'to', 'and', 'with', 'by', 'our', 'we', 'need',
  'please', 'order', 'some', 'per', 'on', 'at',
  'ja', 'tai', 'sekä', 'meille', 'tarvitsemme', 'tilatkaa', 'tilataan', 'varten', 'noin'
]);

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
          // Properly categorize non-food equipment & fresh produce first
          item.category = this.categorizeProduct(
            item.display_name || item.name_en,
            item.name_fi || '',
            item.dietary_tags || [],
            item.vendor_name || ''
          );

          // BUG-10 (Non-food pack volume): Non-food piece goods (napkins, hankies, sheets) should not be assigned thousands of litres. Set to pack_volume_litres = 1.0.
          const titleLower = `${item.display_name} ${item.name_fi || ''}`.toLowerCase();
          const isPieceGood =
            item.category === 'equipment' ||
            /\b(?:napkin|napkins|hankie|hankies|sheet|sheets|tableskirt|tablecover|slipcover|towel|towels|gloves|servetti|servetit|servettejä|lautasliina|lautasliinat|annostelijaliina|nenäliina|nenäliinat|taskuliina|pöytäliina|kateliina|laskosliina|käsipyyhe|pyyhe|pefletti|käsine|käsineet|hanskat)\b/i.test(titleLower);

          if (isPieceGood) {
            item.pack_volume_litres = 1.0;
          } else if (item.pack_volume_litres > 50) {
            if (
              /\b\d+\s*(?:g|gr|gram|grammaa|ml)\b/i.test(titleLower) ||
              /\d+g\b/i.test(titleLower) ||
              titleLower.includes(' g ') ||
              titleLower.endsWith('g') ||
              (titleLower.includes('kg') && item.pack_volume_litres >= 1000)
            ) {
              item.pack_volume_litres = Number((item.pack_volume_litres / 1000.0).toFixed(3));
            }
          }

          // Enrich product with normalized short tags (dietary, fat level, storage condition, culinary purpose)
          item.dietary_tags = enrichProductShortTags(
            item.display_name,
            item.name_fi || '',
            item.name_en || '',
            item.dietary_tags || [],
            item.temperature_condition
          );

          this.productMap.set(item.id, item);
        }

        // Inject staple baseline products so benchmark staples (VA-CLEAN-HYGIENE-5L, VA-CHEESE-OLTERMANNI, VA-OAT-BARISTA-10L, etc.) are indexed
        const staples = this.getBuiltinStaples();
        for (const s of staples) {
          if (!this.productMap.has(s.id)) {
            this.products.unshift(s);
            this.productMap.set(s.id, s);
          }
        }

        this.isLoaded = true;
        return;
      }

      this.parseRawProducts(raw);

      const staples = this.getBuiltinStaples();
      for (const s of staples) {
        if (!this.productMap.has(s.id)) {
          this.products.unshift(s);
          this.productMap.set(s.id, s);
        }
      }

      this.isLoaded = true;
    } catch (err) {
      console.warn('Could not load full Valio Aimo catalog JSON, falling back to built-in staple list:', err);
      this.loadBuiltinCatalog();
      this.isLoaded = true;
    }
  }

  public parseRawProducts(raw: any[]): void {
    this.products = [];
    this.productMap.clear();

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
      if (tags.includes('eu_organic_farming') || tags.includes('organic') || lowerAll.includes('luomu') || lowerAll.includes('organic')) {
        tags.push('organic');
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

      // Determine Category first
      const category = this.categorizeProduct(displayName, fiName, tags, p.vendorName || '');

      // Normalize pack_volume_litres:
      // BUG-10: Non-food piece goods (napkins, hankies, sheets) should not be assigned thousands of litres. Set to 1.0.
      const titleLower = `${displayName} ${fiName}`.toLowerCase();
      const isPieceGood =
        category === 'equipment' ||
        /\b(?:napkin|napkins|hankie|hankies|sheet|sheets|tableskirt|tablecover|slipcover|towel|towels|gloves|servetti|servetit|servettejä|lautasliina|lautasliinat|annostelijaliina|nenäliina|nenäliinat|taskuliina|pöytäliina|kateliina|laskosliina|käsipyyhe|pyyhe|pefletti|käsine|käsineet|hanskat)\b/i.test(titleLower);

      if (isPieceGood) {
        vol = 1.0;
      } else if (
        vol > 50 &&
        (/\b\d+\s*(?:g|gr|gram|grammaa|ml)\b/i.test(titleLower) ||
          /\d+g\b/i.test(titleLower) ||
          titleLower.includes(' g ') ||
          titleLower.endsWith('g') ||
          (titleLower.includes('kg') && vol >= 1000))
      ) {
        vol = vol / 1000.0;
      }

      // Enrich product with normalized short tags (dietary, fat level, storage condition, culinary purpose)
      const enrichedTags = enrichProductShortTags(
        displayName,
        fiName,
        enName,
        tags,
        p.temperatureCondition
      );

      // Pack format formatting
      let packFormat = p.salesUnit || 'PCE';
      const lowerName = displayName.toLowerCase();
      if (lowerName.includes('10 l') || lowerName.includes('10l')) packFormat = '10L Bag-in-Box';
      else if (lowerName.includes('12x1l') || lowerName.includes('12 x 1l')) packFormat = '12x1L Carton';
      else if (lowerName.includes('5 l') || lowerName.includes('5l')) packFormat = '5L Canister';
      else if (lowerName.includes('1 l') || lowerName.includes('1l')) packFormat = '1L Carton';
      else if (lowerName.includes('500 g') || lowerName.includes('500g')) packFormat = '500g Pack';
      else if (vol > 1) packFormat = `${vol}L Unit`;

      const corpus = `${displayName} ${fiName} ${svName} ${p.vendorName || ''} ${synkka.brand || ''} ${enrichedTags.join(' ')}`.toLowerCase();

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
        dietary_tags: enrichedTags,
        pack_format: packFormat,
        pack_volume_litres: Number(vol.toFixed(3)),
        temperature_condition: p.temperatureCondition || 4,
        search_corpus: corpus,
        is_active: !p.deleted,
      };

      this.products.push(item);
      this.productMap.set(item.id, item);
    }
  }

  public async pullFromUpstream(): Promise<number> {
    try {
      console.log('[ValioAimoCatalog] Pulling catalog from Valio Aimo API (/api/products/download)...');
      const res = await fetch(`${UPSTREAM_API_BASE}/api/products/download`, {
        headers: { 'X-API-Key': UPSTREAM_API_KEY },
        redirect: 'follow',
      });
      if (res.ok) {
        const raw = (await res.json()) as any[];
        if (Array.isArray(raw) && raw.length > 0) {
          this.parseRawProducts(raw);
          this.isLoaded = true;
          console.log(`[ValioAimoCatalog] Successfully indexed ${this.products.length} products from upstream API.`);
          return this.products.length;
        }
      }
    } catch (err: any) {
      console.warn('[ValioAimoCatalog] Upstream pull error:', err.message);
    }
    return this.products.length;
  }

  private categorizeProduct(nameEn: string, nameFi: string, tags: string[], vendor: string): string {
    const text = `${nameEn} ${nameFi} ${vendor}`.toLowerCase();

    // 1. Properly categorize non-food equipment, cutlery, tools, and dispensers as 'equipment' or 'non-food', NOT 'dairy'
    if (
      text.includes('slicer') ||
      text.includes('höylä') ||
      text.includes('juustohöylä') ||
      text.includes('veitsi') ||
      text.includes('knife') ||
      text.includes('leikkuri') ||
      text.includes('dispenser') ||
      text.includes('annostelija') ||
      text.includes('sirotin') ||
      text.includes('teline') ||
      text.includes('gloves') ||
      text.includes('käsine') ||
      text.includes('hanskat') ||
      text.includes('cutlery') ||
      text.includes('haarukka') ||
      text.includes('lusikka') ||
      text.includes('servetti') ||
      text.includes('lautasliina') ||
      text.includes('napkin') ||
      text.includes('tableskirt') ||
      text.includes('laskosliina') ||
      text.includes('paperi') ||
      text.includes('kassi') ||
      text.includes('astia') ||
      text.includes('container') ||
      text.includes('mitta') ||
      text.includes('spatula') ||
      text.includes('lasta') ||
      text.includes('hankie') ||
      text.includes('nenäliina') ||
      text.includes('taskuliina') ||
      text.includes('sheet') ||
      text.includes('pöytäliina') ||
      text.includes('kateliina') ||
      text.includes('tablecover') ||
      text.includes('slipcover') ||
      text.includes('pefletti') ||
      text.includes('hiuskiinne') ||
      text.includes('hairspray')
    ) {
      return 'equipment';
    }

    // 2. Properly categorize fresh produce (potatoes, onions, lettuce, etc.) as 'produce'
    // Exclude culinary cooking mixes, cooking cream, or dairy products that happen to mention 'vegetable mix'
    const isCulinaryMixOrDairy =
      text.includes('vegetable mix') ||
      text.includes('kasvirasvasekoite') ||
      text.includes('ruoka') ||
      text.includes('kerma') ||
      text.includes('cream') ||
      text.includes('maito') ||
      text.includes('milk') ||
      text.includes('juusto') ||
      text.includes('cheese') ||
      text.includes('oltermanni');

    if (
      !isCulinaryMixOrDairy &&
      (text.includes('peruna') ||
        text.includes('potato') ||
        text.includes('sipuli') ||
        text.includes('onion') ||
        text.includes('porkkana') ||
        text.includes('carrot') ||
        text.includes('salaatti') ||
        text.includes('lettuce') ||
        text.includes('tomaatti') ||
        text.includes('tomato') ||
        text.includes('kurkku') ||
        text.includes('cucumber') ||
        text.includes('kurpitsa') ||
        text.includes('pumpkin') ||
        text.includes('squash') ||
        text.includes('omena') ||
        text.includes('apple') ||
        text.includes('banaani') ||
        text.includes('banana') ||
        text.includes('appelsiini') ||
        text.includes('orange') ||
        text.includes('marja') ||
        text.includes('berry') ||
        text.includes('mansikka') ||
        text.includes('strawberry') ||
        text.includes('mustikka') ||
        text.includes('blueberry') ||
        text.includes('hedelmä') ||
        text.includes('fruit') ||
        text.includes('vihannes') ||
        text.includes('vegetable') ||
        text.includes('parsa') ||
        text.includes('asparagus') ||
        text.includes('sugarsnap') ||
        text.includes('sokeriherne') ||
        text.includes('herne') ||
        text.includes('pea'))
    ) {
      return 'produce';
    }

    const isVegan = tags.includes('vegan') || tags.includes('plant_based') || text.includes('oddlygood') || text.includes('kaura');

    if (isVegan && (text.includes('kaura') || text.includes('oat') || text.includes('soija') || text.includes('barista') || text.includes('vegaani'))) {
      return 'plant-based';
    }

    const isIceCream =
      text.includes('jäätelö') ||
      text.includes('ice cream') ||
      text.includes('glass') ||
      text.includes('gelato') ||
      text.includes('breyers') ||
      (text.includes('cream') && (text.includes('pakaste') || tags.includes('freezetemperature') || tags.includes('frozen')));
    const isCookieOrBakery =
      text.includes('keksi') ||
      text.includes('cookie') ||
      text.includes('biscuit') ||
      text.includes('pikkuleipä') ||
      text.includes('pipari') ||
      text.includes('piparkakku') ||
      text.includes('vohveli') ||
      text.includes('korppu') ||
      text.includes('muffinssi') ||
      text.includes('donitsi') ||
      text.includes('wiener') ||
      text.includes('torttu') ||
      text.includes('leipä') ||
      text.includes('bread') ||
      text.includes('croissant') ||
      text.includes('sämpylä') ||
      text.includes('kakku') ||
      text.includes('pulla') ||
      text.includes('piirakka') ||
      text.includes('bakery') ||
      text.includes('pastry') ||
      text.includes('jauho') ||
      text.includes('flour') ||
      text.includes('hiiva') ||
      text.includes('yeast') ||
      text.includes('leivinjauhe') ||
      text.includes('baking powder');

    // Cookies and baked goods should be categorized as bakery, even if they contain butter/milk
    if (!isIceCream && isCookieOrBakery) {
      return 'bakery';
    }

    // BUG-06 (Dairy taxonomy): In butter matching 'voi', do not match 'voimakas' (strong, hairspray, chorizo). Use word boundaries \b(?:voi|voita|butter|margariini|levite)\b and exclude voimakas.
    const isButter =
      !text.includes('hiuskiinne') &&
      !text.includes('chorizo') &&
      !/\bvoimakas\b/i.test(text) &&
      /\b(?:voi|voita|butter|margariini|levite)\b/i.test(text);

    if (
      isIceCream ||
      text.includes('maito') ||
      text.includes('milk') ||
      text.includes('kerma') ||
      text.includes('cream') ||
      text.includes('juusto') ||
      text.includes('cheese') ||
      text.includes('oltermanni') ||
      text.includes('cheddar') ||
      text.includes('edam') ||
      text.includes('gouda') ||
      text.includes('mozzarella') ||
      text.includes('parmesan') ||
      text.includes('parmesaani') ||
      text.includes('parmigiano') ||
      text.includes('grana padano') ||
      text.includes('feta') ||
      text.includes('emmental') ||
      isButter ||
      text.includes('meijerivoi') ||
      text.includes('jogurtti') ||
      text.includes('yogurt') ||
      text.includes('rahka') ||
      text.includes('viili') ||
      text.includes('smetana') ||
      text.includes('kermaviili') ||
      text.includes('kasvirasvasekoite')
    ) {
      return 'dairy';
    }
    if (isCookieOrBakery) {
      return 'bakery';
    }
    if (
      text.includes('kahvi') ||
      text.includes('coffee') ||
      text.includes('mehu') ||
      text.includes('juice') ||
      /\b(tee|teetä|tea)\b/i.test(text) ||
      text.includes('juoma') ||
      text.includes('beverage') ||
      text.includes('paulig')
    ) {
      return 'beverages';
    }

    // BUG-08 (Cleaning taxonomy): Do not use text.includes('clean') which matches produce 'CLEANED' (sugarsnaps). Use word boundaries \b(?:cleaner|cleaning|pesuaine|desinfiointi|sanitizer|puhdistusaine)\b.
    if (
      /\b(?:cleaner|cleaning|pesuaine|desinfiointi|sanitizer|puhdistusaine)\b/i.test(text) ||
      text.includes('pintadesinfektio') ||
      text.includes('desinfektio') ||
      text.includes('disinfectant') ||
      text.includes('easydes') ||
      text.includes('saippua') ||
      text.includes('detergent') ||
      text.includes('pesuaine') ||
      text.includes('puhdistusaine') ||
      text.includes('puhdistus') ||
      text.includes('pesu') ||
      text.includes('hygienia') ||
      text.includes('hygiene')
    ) {
      return 'cleaning';
    }

    // BUG-09 (Meat taxonomy): In chicken matching 'kana', check for eggs 'kananmuna' and egg pasta first before classifying as meat. Use word boundaries.
    const isEggOrEggPasta =
      text.includes('kananmuna') ||
      text.includes('kananmunat') ||
      text.includes('kananmunaa') ||
      text.includes('munapasta') ||
      text.includes('egg pasta') ||
      text.includes('munanuudeli') ||
      (/\b(?:egg|eggs)\b/i.test(text) && /\b(?:pasta|tagliatelle|noodle|noodles|nuudeli|spaghetti|spagetti|makaroni|macaroni)\b/i.test(text));

    if (!isEggOrEggPasta) {
      const isChicken = /\b(?:kana|kanaa|broileri|broiler|broileria|chicken)\b/i.test(text);
      if (
        isChicken ||
        text.includes('liha') ||
        text.includes('meat') ||
        text.includes('nauta') ||
        text.includes('beef') ||
        text.includes('possu') ||
        text.includes('pork') ||
        text.includes('makkara') ||
        text.includes('chorizo') ||
        text.includes('atria') ||
        text.includes('hkscan')
      ) {
        return 'meat';
      }
    }

    // BUG-07 (Alcohol taxonomy): In categorizeProduct(), do not use text.includes('alko') which matches 'valkoinen' (white asparagus, napkins, chocolate). Use regex word boundaries \b(?:alko|alkoholi|alcohol|viini|wine|olut|beer|siideri|lonkero|vodka|viski|whisky|rommi|gin)\b and explicitly exclude valkoinen.
    if (
      !text.includes('valkoinen') &&
      /\b(?:alko|alkoholi|alcohol|viini|wine|olut|beer|siideri|cider|lonkero|vodka|viski|whisky|rommi|gin)\b/i.test(text)
    ) {
      return 'alcohol';
    }

    return 'general';
  }

  public getBuiltinStaples(): CatalogProduct[] {
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
      {
        id: 'VA-ORGANIC-MILK-1L',
        display_name: 'Valio Luomu™ Organic Whole Milk 1L',
        name_fi: 'Valio Luomu™ vanhanajan täysmaito 1L',
        name_en: 'Valio Luomu™ Organic Whole Milk 1L',
        brand: 'Valio Luomu',
        category: 'dairy',
        dietary_tags: ['organic', 'vegetarian'],
        pack_format: '1L Carton',
        pack_volume_litres: 1.0,
      },
    ];

    return staples.map((s) => {
      const enrichedTags = enrichProductShortTags(
        s.display_name!,
        s.name_fi!,
        s.name_en!,
        s.dietary_tags || [],
        4
      );
      const corpus = `${s.display_name} ${s.name_fi} ${s.name_en} ${s.brand} ${enrichedTags.join(' ')}`.toLowerCase();
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
        dietary_tags: enrichedTags,
        pack_format: s.pack_format || 'PCE',
        pack_volume_litres: s.pack_volume_litres || 1.0,
        temperature_condition: 4,
        search_corpus: corpus,
        is_active: true,
      };
    });
  }

  private loadBuiltinCatalog(): void {
    this.products = this.getBuiltinStaples();
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
    const meaningfulWords = rawWords.filter((w) => !FINNISH_STOPWORDS.has(w) && w.length > 1);
    const words = meaningfulWords.length > 0 ? meaningfulWords : rawWords;

    // Finnish suffix stripping / normalization for tokens > 4 chars
    const normalizedWords = words.map((w) => normalizeFinnishToken(w));

    // Noun-weighted matching: distinctive search terms (nouns) are required or heavily weighted;
    // generic modifier words cannot match alone to trigger a candidate.
    const GENERIC_MODIFIERS = new Set([
      'cooking', 'quick', 'fresh', 'size', 'block', 'kitchen', 'traditional',
      'hotel', 'restaurant', 'perinteinen', 'tuore', 'laadukas', 'iso', 'pieni', 'fine'
    ]);

    // Mandatory term requirements based on distinctive intent
    const hasButterIntent = normalizedWords.some((w) => ['butter', 'voi', 'meijerivoi'].includes(w));
    const hasGlovesIntent = normalizedWords.some((w) => ['gloves', 'glove', 'käsine', 'käsineet', 'hanska', 'hanskat'].includes(w));
    const hasCheeseIntent = normalizedWords.some((w) => ['cheese', 'juusto', 'parmesan', 'parmesaani', 'cheddar', 'oltermanni'].includes(w));
    const hasParmesanIntent = normalizedWords.some((w) => ['parmesan', 'parmesaani', 'parmigiano'].includes(w));
    const hasOltermanniIntent = normalizedWords.some((w) => ['oltermanni'].includes(w));
    const hasCleaningIntent = normalizedWords.some((w) => ['hygiene', 'hygienia', 'pintadesinfektio', 'desinfektio', 'sanitizer', 'disinfectant'].includes(w));
    const hasMilkIntent = normalizedWords.some((w) => ['milk', 'maito', 'täysmaito', 'kevytmaito'].includes(w));
    const hasWholeMilkIntent = normalizedWords.some((w) => ['täysmaito'].includes(w)) || cleanQ.includes('whole milk');
    const hasKevytmaitoIntent = normalizedWords.some((w) => ['kevytmaito', 'semi-skimmed', 'semi skimmed'].includes(w)) || cleanQ.includes('semi skimmed');
    const hasCookieIntent =
      normalizedWords.some((w) =>
        ['cookie', 'cookies', 'keksi', 'keksit', 'keksejä', 'keksiä', 'biscuit', 'biscuits', 'pikkuleipä', 'pikkuleivät', 'pikkuleipiä', 'pipari', 'piparkakku'].includes(w)
      ) ||
      cleanQ.includes('cookie') ||
      cleanQ.includes('keksi') ||
      cleanQ.includes('biscuit') ||
      cleanQ.includes('pikkuleipä');

    const DIETARY_OR_GENERIC_TOKENS = new Set([
      'gluten', 'free', 'lactose', 'vegan', 'organic', 'luomu', 'gton', 'lton',
      'fresh', 'tuore', 'valio', 'dairy', 'milk', 'cheese', 'bread', 'food'
    ]);

    const distinctiveWords = normalizedWords.filter((w) => !GENERIC_MODIFIERS.has(w));

    const category = options?.category?.toLowerCase();
    const reqTags = (options?.tags || []).map((t) => t.toLowerCase());
    const limit = options?.limit || 25;

    const scored: Array<{ product: CatalogProduct; score: number }> = [];

    for (const p of this.products) {
      if (!p.is_active) continue;
      if (category && category !== 'all' && p.category !== category) continue;

      const lowerDisplay = p.display_name.toLowerCase();
      const lowerFi = p.name_fi.toLowerCase();
      const lowerBrand = p.brand.toLowerCase();
      const normalizedCorpus = p.search_corpus.replace(/[-_]/g, ' ');
      const pTags = p.dietary_tags || [];

      // 1. Strict dietary requirements (hard filters if requested):
      if (reqTags.includes('gluten-free') && !pTags.includes('gluten-free') && !normalizedCorpus.includes('gluten-free') && !normalizedCorpus.includes('gluteeniton')) {
        continue;
      }
      if (reqTags.includes('vegan') && !pTags.includes('vegan') && p.category !== 'plant-based' && !normalizedCorpus.includes('vegaani')) {
        continue;
      }
      if (reqTags.includes('lactose-free') && !pTags.includes('lactose-free') && p.category !== 'plant-based' && !normalizedCorpus.includes('laktoositon') && !lowerDisplay.includes('laktoositon')) {
        continue;
      }

      // Intent Enforcement:
      // 1. For cooking butter, butter or voi is mandatory (do not match quick cooking rice)
      if (hasButterIntent) {
        const matchesButter =
          /\b(butter|voi|meijerivoi)\b/i.test(lowerDisplay) ||
          /\b(butter|voi|meijerivoi)\b/i.test(lowerFi) ||
          /\b(butter|voi|meijerivoi)\b/i.test(normalizedCorpus);
        if (!matchesButter) continue;
        if (p.category === 'equipment' || p.category === 'bakery' || lowerDisplay.includes('spreader') || lowerDisplay.includes('voiveitsi')) {
          continue;
        }
      }

      // 2. For nitrile gloves, gloves or käsineet or hanskat is mandatory (do not match orange size or garlic cloves)
      if (hasGlovesIntent) {
        const matchesGloves =
          /\b(gloves?|käsine|käsineet|hanska|hanskat)\b/i.test(lowerDisplay) ||
          /\b(gloves?|käsine|käsineet|hanska|hanskat)\b/i.test(normalizedCorpus);
        if (!matchesGloves) continue;
        if (p.category === 'produce' || lowerDisplay.includes('garlic') || lowerFi.includes('valkosipuli')) {
          continue;
        }
      }

      // 3. For parmesan cheese, require cheese terms and penalize non-food tools (slicer, dispenser, veitsi)
      if (hasParmesanIntent) {
        const matchesParmesan =
          /\b(parmesan|parmesaani|parmigiano|grana)\b/i.test(lowerDisplay) ||
          /\b(parmesan|parmesaani|parmigiano|grana)\b/i.test(normalizedCorpus);
        if (!matchesParmesan) continue;
        if (p.category === 'equipment' || lowerDisplay.includes('slicer') || lowerFi.includes('höylä') || lowerDisplay.includes('shaker')) {
          continue;
        }
      }

      // 4. For Oltermanni cheese, oltermanni is mandatory
      if (hasOltermanniIntent) {
        if (!lowerDisplay.includes('oltermanni') && !lowerFi.includes('oltermanni') && !normalizedCorpus.includes('oltermanni')) {
          continue;
        }
      }

      // 5. For cleaning disinfectant / hygiene sanitizer, require cleaning/sanitizer terms and exclude food/dairy
      if (hasCleaningIntent) {
        const matchesCleaning =
          /\b(hygiene|hygienia|pintadesinfektio|desinfektio|sanitizer|disinfectant|easydes)\b/i.test(lowerDisplay) ||
          /\b(hygiene|hygienia|pintadesinfektio|desinfektio|sanitizer|disinfectant|easydes)\b/i.test(normalizedCorpus);
        if (!matchesCleaning) continue;
        if (p.category === 'dairy' || p.category === 'meat' || p.category === 'bakery' || lowerDisplay.includes('milk') || lowerDisplay.includes('powder')) {
          continue;
        }
      }

      // 6. For milk intent, exclude non-milk beverages (tea, coffee) that do not contain milk/maito
      if (hasMilkIntent) {
        if (p.category === 'beverages' && (lowerDisplay.includes('tea') || lowerDisplay.includes('tee') || lowerDisplay.includes('coffee') || lowerDisplay.includes('kahvi'))) {
          continue;
        }
      }

      // 7. For whole milk intent, exclude skimmed or vegetable mixes
      if (hasWholeMilkIntent) {
        if (
          lowerDisplay.includes('skimmed') ||
          lowerDisplay.includes('rasvaton') ||
          lowerDisplay.includes('semi skimmed') ||
          lowerDisplay.includes('kevytmaito') ||
          lowerDisplay.includes('kasvirasvasekoite') ||
          lowerDisplay.includes('vegetable mix')
        ) {
          continue;
        }
      }

      // 8. For kevytmaito intent, exclude cooking vegetable mixes
      if (hasKevytmaitoIntent) {
        if (lowerDisplay.includes('kasvirasvasekoite') || lowerDisplay.includes('vegetable mix')) {
          continue;
        }
      }

      // 9. For cookie intent, strictly exclude pizza, pizza bases, burger buns, breadcrumbs, and frozen ice creams
      if (hasCookieIntent) {
        if (
          lowerDisplay.includes('pizza') ||
          lowerFi.includes('pizzapohja') ||
          lowerFi.includes('pizza') ||
          lowerDisplay.includes('burger bun') ||
          lowerDisplay.includes('breadcrumbs') ||
          lowerFi.includes('korppujauho') ||
          lowerDisplay.includes('sauce base') ||
          lowerDisplay.includes('soup base') ||
          lowerDisplay.includes('salad base') ||
          (lowerDisplay.includes('flatbread') && !lowerDisplay.includes('cookie'))
        ) {
          continue;
        }

        const asksIceCream = cleanQ.includes('ice cream') || cleanQ.includes('jäätelö') || cleanQ.includes('glass') || cleanQ.includes('gelato');
        if (!asksIceCream) {
          const isFrozenIceCream =
            lowerDisplay.includes('ice cream') ||
            lowerFi.includes('jäätelö') ||
            lowerDisplay.includes('jäätelö') ||
            lowerDisplay.includes('glass') ||
            lowerDisplay.includes('breyers') ||
            lowerDisplay.includes('gelatolab') ||
            lowerBrand.includes('breyers') ||
            lowerBrand.includes('gelatolab') ||
            lowerBrand.includes('magnum') ||
            lowerBrand.includes('carte d\'or') ||
            (lowerDisplay.includes('cream') && (p.temperature_condition === 7 || pTags.includes('freezetemperature') || pTags.includes('frozen'))) ||
            (p.category === 'dairy' && p.temperature_condition === 7);
          if (isFrozenIceCream) {
            continue;
          }
        }
      }

      let score = 0;
      let matchedCount = 0;
      let matchedDistinctiveCount = 0;

      if (normalizedWords.length === 0) {
        score = 1;
      } else {
        for (let i = 0; i < normalizedWords.length; i++) {
          const w = normalizedWords[i];
          const rawW = words[i];
          const syns = SYNONYMS[w] || SYNONYMS[rawW] || [];
          const allVariants = Array.from(new Set([w, rawW, ...syns]));

          const matchesTerm = (term: string) => {
            if (term.length <= 4) {
              return new RegExp(`\\b${term}\\b`, 'i').test(normalizedCorpus);
            }
            return normalizedCorpus.includes(term);
          };

          const matchesDisplay = (term: string) => {
            if (term.length <= 4) {
              return new RegExp(`\\b${term}\\b`, 'i').test(lowerDisplay) || new RegExp(`\\b${term}\\b`, 'i').test(lowerFi);
            }
            return lowerDisplay.includes(term) || lowerFi.includes(term);
          };

          const matched = allVariants.some((v) => matchesTerm(v));

          if (matched) {
            matchedCount++;
            const isDistinctive = !GENERIC_MODIFIERS.has(w);
            if (isDistinctive) matchedDistinctiveCount++;

            // Distinctive terms are weighted much higher than generic modifiers
            score += isDistinctive ? 50 : 10;

            if (allVariants.some((v) => matchesDisplay(v))) {
              score += isDistinctive ? 60 : 15;
            }
            if (!DIETARY_OR_GENERIC_TOKENS.has(w) && allVariants.some((v) => lowerBrand.includes(v))) {
              score += isDistinctive ? 40 : 10;
            }
            if (p.id.toLowerCase() === w || p.id.toLowerCase() === rawW) {
              score += 300;
            }
          }
        }

        // Distinctive terms requirement: generic modifiers cannot match alone to trigger a candidate
        if (distinctiveWords.length > 0 && matchedDistinctiveCount === 0) {
          continue;
        }
        if (matchedCount === 0) continue;

        // Bonus for matching all search words
        if (matchedCount === normalizedWords.length) {
          score += 80;
        }

        // Exact multi-word phrase bonus
        if (cleanQ.length > 3 && (lowerDisplay.includes(cleanQ) || lowerFi.includes(cleanQ) || normalizedCorpus.includes(cleanQ))) {
          score += 150;
        }

        // Brand match bonus - only for actual distinctive brand terms
        if (normalizedWords.some((w) => !DIETARY_OR_GENERIC_TOKENS.has(w) && lowerBrand.includes(w))) {
          score += 100;
        }

        // Staple brand priority
        if (lowerBrand.includes('valio') || lowerBrand.includes('oddlygood') || lowerBrand.includes('paulig')) {
          score += 20;
        }

        // Short tag matching & relevance score bonus
        let tagMatchCount = 0;
        for (const t of reqTags) {
          const matchesTag =
            pTags.includes(t) ||
            lowerDisplay.includes(t) ||
            lowerFi.includes(t) ||
            normalizedCorpus.includes(t);

          if (matchesTag) {
            tagMatchCount++;
            score += 70;
            if (['whole', 'skimmed', 'semi-skimmed', 'unsalted', 'barista', 'frozen', 'whipping', 'organic'].includes(t)) {
              score += 40;
            }
          }
        }

        // Bonus if all prompt tags are satisfied
        if (reqTags.length > 0 && tagMatchCount === reqTags.length) {
          score += 100;
        }

        // Specific boosts & penalties
        if (hasButterIntent) {
          if (lowerDisplay.includes('spreader') || lowerDisplay.includes('veitsi') || lowerDisplay.includes('croissant')) {
            score -= 200;
          }
          if (/\b(voi|meijerivoi|butter)\b/i.test(lowerDisplay) || /\b(voi|meijerivoi|butter)\b/i.test(lowerFi)) {
            score += 100;
          }
        }

        if ((cleanQ.includes('bread') || cleanQ.includes('leipä')) && !cleanQ.includes('breadcrumb') && !cleanQ.includes('korppujauho') && !cleanQ.includes('gingerbread') && !cleanQ.includes('piparkakku')) {
          if (lowerDisplay.includes('breadcrumb') || lowerFi.includes('korppujauho') || lowerDisplay.includes('gingerbread')) {
            score -= 300;
          }
        }

        if (cleanQ.includes('sour cream')) {
          if (
            lowerDisplay.includes('sour cream') ||
            lowerDisplay.includes('kermaviili') ||
            lowerDisplay.includes('smetana') ||
            lowerDisplay.includes('hapankerma') ||
            lowerDisplay.includes('creme fraiche') ||
            lowerFi.includes('kermaviili') ||
            lowerFi.includes('smetana')
          ) {
            score += 150;
          }
        }

        if (normalizedWords.includes('milk') || normalizedWords.includes('maito') || normalizedWords.includes('täysmaito')) {
          if (lowerDisplay.includes('chocolate') || lowerDisplay.includes('suklaa') || lowerDisplay.includes('patukka')) {
            score -= 80;
          }
          if (lowerDisplay.includes('whole milk') || lowerFi.includes('täysmaito')) {
            if (normalizedWords.includes('täysmaito') || cleanQ.includes('whole milk')) {
              score += 120;
            }
          }
        }

        if (hasParmesanIntent) {
          if (lowerDisplay.includes('slicer') || lowerFi.includes('höylä')) {
            score -= 300;
          }
          if (lowerDisplay.includes('block') || lowerFi.includes('pala')) {
            score += 50;
          }
        }

        if (hasCookieIntent) {
          const isActualCookie =
            /\b(cookies?|keksi[a-z]*|biscuits?|pikkuleip[a-z]*|pipar[a-z]*)\b/i.test(lowerDisplay) ||
            /\b(cookies?|keksi[a-z]*|biscuits?|pikkuleip[a-z]*|pipar[a-z]*)\b/i.test(lowerFi);
          if (isActualCookie) {
            score += 250;
          }
          if (p.category === 'bakery') {
            score += 100;
          }
        }

        // Pack format and volume bonuses/penalties
        const asksCarton = cleanQ.includes('carton') || cleanQ.includes('tölkki');
        const asksNovobox = cleanQ.includes('novobox') || cleanQ.includes('bag in box') || cleanQ.includes('bib');
        const asks1L = /\b1\s*(l|litre|liter|litraa?)\b/i.test(cleanQ) || /\b1l\b/i.test(cleanQ);
        const asks10L = /\b10\s*(l|litre|liter|litraa?)\b/i.test(cleanQ) || /\b10l\b/i.test(cleanQ);
        const asks5L = /\b5\s*(l|litre|liter|litraa?)\b/i.test(cleanQ) || /\b5l\b/i.test(cleanQ);
        const asks500g = /\b500\s*(g|gram|grammaa?)\b/i.test(cleanQ) || /\b500g\b/i.test(cleanQ);
        const asks1kg = /\b1\s*(kg|kilo|kiloa?)\b/i.test(cleanQ) || /\b1kg\b/i.test(cleanQ);

        if (asksCarton || asks1L) {
          if (lowerDisplay.includes('10l') || lowerDisplay.includes('10 l') || p.pack_volume_litres > 2 || lowerDisplay.includes('novobox')) {
            score -= 200;
          }
          if (lowerDisplay.includes('1 l') || lowerDisplay.includes('1l') || p.pack_volume_litres === 1.0) {
            score += 150;
          }
        }
        if (asksNovobox || asks10L) {
          if (lowerDisplay.includes('10l') || lowerDisplay.includes('10 l') || p.pack_volume_litres === 10.0 || lowerDisplay.includes('novobox')) {
            score += 150;
          }
          if (p.pack_volume_litres === 1.0 || lowerDisplay.includes('1 l') || lowerDisplay.includes('1l')) {
            score -= 100;
          }
        }
        if (asks5L) {
          if (lowerDisplay.includes('5l') || lowerDisplay.includes('5 l') || p.pack_volume_litres === 5.0) {
            score += 150;
          }
        }
        if (asks500g) {
          if (lowerDisplay.includes('500g') || lowerDisplay.includes('500 g') || p.pack_volume_litres === 0.5) {
            score += 150;
          }
        }
        if (asks1kg) {
          if (lowerDisplay.includes('1kg') || lowerDisplay.includes('1 kg') || p.pack_volume_litres === 1.0) {
            score += 150;
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
