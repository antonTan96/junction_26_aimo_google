import mysql from 'mysql2/promise';
import type { CatalogProduct } from './valioAimoCatalog.ts';

export interface MariaDBConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export class MariaDBCatalogClient {
  private static instance: MariaDBCatalogClient | null = null;
  private pool: mysql.Pool | null = null;
  private isConnected = false;
  private initPromise: Promise<boolean> | null = null;

  public static getInstance(): MariaDBCatalogClient {
    if (!MariaDBCatalogClient.instance) {
      MariaDBCatalogClient.instance = new MariaDBCatalogClient();
    }
    return MariaDBCatalogClient.instance;
  }

  public async getPool(): Promise<mysql.Pool | null> {
    if (this.initPromise) {
      await this.initPromise;
      return this.pool;
    }

    const host = process.env.MARIADB_HOST || process.env.MYSQL_HOST;
    if (!host) {
      return null;
    }

    this.initPromise = (async () => {
      try {
        const pool = mysql.createPool({
          host,
          port: Number(process.env.MARIADB_PORT || process.env.MYSQL_PORT || 3306),
          user: process.env.MARIADB_USER || process.env.MYSQL_USER || 'root',
          password: process.env.MARIADB_PASSWORD || process.env.MYSQL_PASSWORD || '',
          database: process.env.MARIADB_DATABASE || process.env.MYSQL_DATABASE || 'aimogate',
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
        });

        // Test connection
        const conn = await pool.getConnection();
        conn.release();
        this.pool = pool;
        this.isConnected = true;
        console.log(`[MariaDB] Connected successfully to ${host}:${process.env.MARIADB_PORT || 3306}/${process.env.MARIADB_DATABASE || 'aimogate'}`);
        return true;
      } catch (err: any) {
        console.warn(`[MariaDB] Connection attempt failed (${err.message}), falling back to in-memory JSON catalog.`);
        this.pool = null;
        this.isConnected = false;
        return false;
      }
    })();

    await this.initPromise;
    return this.pool;
  }

  public isAvailable(): boolean {
    return this.isConnected && this.pool !== null;
  }

  public async searchProducts(
    query: string,
    options?: {
      category?: string;
      tags?: string[];
      limit?: number;
    }
  ): Promise<CatalogProduct[] | null> {
    const pool = await this.getPool();
    if (!pool) return null;

    try {
      const limit = Math.min(options?.limit || 24, 100);
      const category = options?.category?.toLowerCase();
      const whereClauses: string[] = ['is_active = 1'];
      const params: any[] = [];

      if (category && category !== 'all') {
        whereClauses.push('category = ?');
        params.push(category);
      }

      const cleanQ = (query || '').trim().replace(/['"+\-*()~]/g, ' ');
      if (cleanQ) {
        // Boolean mode fulltext search or LIKE fallback
        const words = cleanQ.split(/\s+/).filter(Boolean);
        const booleanQuery = words.map((w) => `+${w}*`).join(' ');
        whereClauses.push('(MATCH(display_name, brand, name_fi, name_en, search_corpus) AGAINST(? IN BOOLEAN MODE) OR display_name LIKE ?)');
        params.push(booleanQuery, `%${cleanQ}%`);
      }

      const sql = `
        SELECT
          id, gtin, name_fi, name_en, name_sv, display_name,
          vendor_name, brand, category, dietary_tags,
          pack_format, pack_volume_litres, temperature_condition,
          search_corpus, is_active
        FROM valio_catalog_products
        WHERE ${whereClauses.join(' AND ')}
        LIMIT ?
      `;
      params.push(limit);

      const [rows] = await pool.query(sql, params);
      const records = rows as any[];

      return records.map((r) => ({
        id: String(r.id),
        gtin: r.gtin || '',
        name_fi: r.name_fi || '',
        name_en: r.name_en || r.name_fi,
        name_sv: r.name_sv || r.name_fi,
        display_name: r.display_name,
        vendor_name: r.vendor_name || 'Valio Aimo',
        brand: r.brand || 'Valio',
        category: r.category || 'dairy',
        dietary_tags: typeof r.dietary_tags === 'string' ? JSON.parse(r.dietary_tags) : (r.dietary_tags || []),
        pack_format: r.pack_format || 'PCE',
        pack_volume_litres: Number(r.pack_volume_litres || 1.0),
        temperature_condition: Number(r.temperature_condition || 4),
        search_corpus: r.search_corpus || '',
        is_active: Boolean(r.is_active),
      }));
    } catch (err: any) {
      console.warn('[MariaDB] searchProducts query error:', err.message);
      return null;
    }
  }

  public async getProductById(id: string): Promise<CatalogProduct | null> {
    const pool = await this.getPool();
    if (!pool) return null;

    try {
      const [rows] = await pool.query('SELECT * FROM valio_catalog_products WHERE id = ? LIMIT 1', [id]);
      const list = rows as any[];
      if (list.length === 0) return null;
      const r = list[0];
      return {
        id: String(r.id),
        gtin: r.gtin || '',
        name_fi: r.name_fi || '',
        name_en: r.name_en || r.name_fi,
        name_sv: r.name_sv || r.name_fi,
        display_name: r.display_name,
        vendor_name: r.vendor_name || 'Valio Aimo',
        brand: r.brand || 'Valio',
        category: r.category || 'dairy',
        dietary_tags: typeof r.dietary_tags === 'string' ? JSON.parse(r.dietary_tags) : (r.dietary_tags || []),
        pack_format: r.pack_format || 'PCE',
        pack_volume_litres: Number(r.pack_volume_litres || 1.0),
        temperature_condition: Number(r.temperature_condition || 4),
        search_corpus: r.search_corpus || '',
        is_active: Boolean(r.is_active),
      };
    } catch (err: any) {
      console.warn('[MariaDB] getProductById error:', err.message);
      return null;
    }
  }

  public async getProductCount(): Promise<number | null> {
    const pool = await this.getPool();
    if (!pool) return null;

    try {
      const [rows] = await pool.query('SELECT COUNT(*) as count FROM valio_catalog_products WHERE is_active = 1');
      const r = (rows as any[])[0];
      return Number(r?.count ?? 0);
    } catch (err: any) {
      return null;
    }
  }
}
