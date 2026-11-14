import fs from 'node:fs';
import { ValioAimoCatalogService } from '../src/lib/valioAimoCatalog.ts';

const inputFile = process.argv[2];
const outputFile = process.argv[3] || 'data/valio_catalog_17546.json';

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(1);
}

console.log(`Processing raw Valio Aimo catalog: ${inputFile} -> ${outputFile}`);
const raw = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

const service = ValioAimoCatalogService.getInstance();
service.parseRawProducts(raw);

const products = (service as any).products;
fs.writeFileSync(outputFile, JSON.stringify(products));
console.log(`Successfully generated ${outputFile} with ${products.length} products.`);
