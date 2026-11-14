import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const CATALOG_JSON_PATH =
  process.env.VALIO_CATALOG_PATH ||
  path.resolve(process.cwd(), '../junction26_aimo/valio_aimo_junction26_product_data.json');

async function main() {
  console.log('--- MariaDB Valio Aimo Ingestion Tool ---');
  console.log(`Source catalog: ${CATALOG_JSON_PATH}`);

  if (!fs.existsSync(CATALOG_JSON_PATH)) {
    console.error(`Error: Catalog JSON file not found at ${CATALOG_JSON_PATH}`);
    process.exit(1);
  }

  const host = process.env.MARIADB_HOST || '127.0.0.1';
  const port = Number(process.env.MARIADB_PORT || 3306);
  const user = process.env.MARIADB_USER || 'root';
  const password = process.env.MARIADB_PASSWORD || '';
  const database = process.env.MARIADB_DATABASE || 'aimogate';

  console.log(`Connecting to MariaDB at ${host}:${port}/${database} as '${user}'...`);

  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
  });

  console.log('Connected! Reading product JSON data...');
  const t0 = Date.now();
  const rawData = JSON.parse(fs.readFileSync(CATALOG_JSON_PATH, 'utf8'));
  console.log(`Loaded ${rawData.length} products into memory in ${((Date.now() - t0) / 1000).toFixed(2)}s.`);

  const insertSql = `
    INSERT INTO valio_catalog_products (
      id, gtin, sales_unit, name_fi, name_en, name_sv,
      display_name, vendor_name, brand, category, dietary_tags,
      pack_format, pack_volume_litres, temperature_condition, search_corpus, is_active
    ) VALUES ?
    ON DUPLICATE KEY UPDATE
      gtin = VALUES(gtin),
      sales_unit = VALUES(sales_unit),
      name_fi = VALUES(name_fi),
      name_en = VALUES(name_en),
      name_sv = VALUES(name_sv),
      display_name = VALUES(display_name),
      vendor_name = VALUES(vendor_name),
      brand = VALUES(brand),
      category = VALUES(category),
      dietary_tags = VALUES(dietary_tags),
      pack_format = VALUES(pack_format),
      pack_volume_litres = VALUES(pack_volume_litres),
      temperature_condition = VALUES(temperature_condition),
      search_corpus = VALUES(search_corpus),
      is_active = VALUES(is_active)
  `;

  const BATCH_SIZE = 500;
  let batch: any[][] = [];
  let totalInserted = 0;

  for (const p of rawData) {
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

    // Categorization
    const text = `${displayName} ${fiName} ${p.vendorName || ''}`.toLowerCase();
    let category = 'dairy';
    if (tags.includes('vegan') || text.includes('kaura') || text.includes('oddlygood')) {
      category = 'plant-based';
    } else if (text.includes('leipä') || text.includes('croissant') || text.includes('bakery')) {
      category = 'bakery';
    } else if (text.includes('kahvi') || text.includes('coffee') || text.includes('mehu') || text.includes('tea')) {
      category = 'beverages';
    } else if (text.includes('pesu') || text.includes('hygienia') || text.includes('clean') || text.includes('sanitizer')) {
      category = 'cleaning';
    } else if (text.includes('liha') || text.includes('meat') || text.includes('kana') || text.includes('beef')) {
      category = 'meat';
    } else if (text.includes('viini') || text.includes('wine') || text.includes('olut') || text.includes('beer')) {
      category = 'alcohol';
    }

    let packFormat = p.salesUnit || 'PCE';
    const lowerName = displayName.toLowerCase();
    if (lowerName.includes('10 l') || lowerName.includes('10l')) packFormat = '10L Bag-in-Box';
    else if (lowerName.includes('12x1l') || lowerName.includes('12 x 1l')) packFormat = '12x1L Carton';
    else if (lowerName.includes('5 l') || lowerName.includes('5l')) packFormat = '5L Canister';
    else if (lowerName.includes('1 l') || lowerName.includes('1l')) packFormat = '1L Carton';
    else if (lowerName.includes('500 g') || lowerName.includes('500g')) packFormat = '500g Pack';
    else if (vol > 1) packFormat = `${vol}L Unit`;

    const corpus = `${displayName} ${fiName} ${svName} ${p.vendorName || ''} ${synkka.brand || ''} ${tags.join(' ')}`.toLowerCase();

    batch.push([
      String(p.id),
      p.salesUnitGtin || synkka.gtin || '',
      p.salesUnit || 'PCE',
      fiName,
      enName,
      svName,
      displayName,
      p.vendorName || 'Valio Aimo',
      synkka.brand || 'Valio',
      category,
      JSON.stringify(tags),
      packFormat,
      Number(vol.toFixed(3)),
      p.temperatureCondition || 4,
      corpus,
      1,
    ]);

    if (batch.length >= BATCH_SIZE) {
      await connection.query(insertSql, [batch]);
      totalInserted += batch.length;
      process.stdout.write(`\rIngested ${totalInserted} / ${rawData.length} items...`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await connection.query(insertSql, [batch]);
    totalInserted += batch.length;
  }

  console.log(`\nSuccess! Ingested ${totalInserted} products into MariaDB in ${((Date.now() - t0) / 1000).toFixed(2)}s.`);
  await connection.end();
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
