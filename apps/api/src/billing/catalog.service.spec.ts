import { CatalogService } from './catalog.service';
import { createBillingDb, type BillingDb } from './testing/in-memory-billing-db';

function setup() {
  const db: BillingDb = createBillingDb();
  db.plugin.rows.push(
    { key: 'docs', name: 'Document Templates', isEnabled: true, pricingModel: 'MONTHLY', price: '50000.00', pricingCurrency: 'IDR', trialDays: 7 },
    { key: 'inventory', name: 'Inventory', isEnabled: true, pricingModel: 'MONTHLY', price: '150000.00', pricingCurrency: 'IDR', trialDays: 0 },
    { key: 'procurement', name: 'Procurement', isEnabled: true, pricingModel: 'MONTHLY', price: '100000.00', pricingCurrency: 'IDR', trialDays: 0 },
  );
  db.app.rows.push({ id: 'app-1', key: 'warehouse', name: 'Warehouse', isPublished: true, pricingModel: 'MONTHLY', price: '200000.00', pricingCurrency: 'IDR', trialDays: 14, icon: 'warehouse' });
  db.appPlugin.rows.push({ appId: 'app-1', pluginKey: 'procurement', position: 1 }, { appId: 'app-1', pluginKey: 'inventory', position: 0 });
  return { db, catalog: new CatalogService(db as any) };
}

describe('CatalogService', () => {
  it('a plugin product', async () => {
    await expect(setup().catalog.getProduct('docs')).resolves.toEqual({
      ref: 'docs', kind: 'plugin', key: 'docs', name: 'Document Templates', pricingModel: 'MONTHLY',
      price: '50000.00', currency: 'IDR', trialDays: 7, available: true, plugins: [],
    });
  });

  it('an app product with contents in position order', async () => {
    const product = await setup().catalog.getProduct('app:warehouse');
    expect(product).toMatchObject({ ref: 'app:warehouse', kind: 'app', key: 'warehouse', name: 'Warehouse', price: '200000.00', currency: 'IDR', trialDays: 14, available: true });
    expect(product?.plugins).toEqual([
      { key: 'inventory', name: 'Inventory', pricingModel: 'MONTHLY', price: '150000.00', currency: 'IDR' },
      { key: 'procurement', name: 'Procurement', pricingModel: 'MONTHLY', price: '100000.00', currency: 'IDR' },
    ]);
  });

  it('a hidden app is not available', async () => {
    const { db, catalog } = setup();
    db.app.rows[0].isPublished = false;
    await expect(catalog.getProduct('app:warehouse')).resolves.toMatchObject({ available: false });
  });

  it('unknown keys give null', async () => {
    const { catalog } = setup();
    await expect(catalog.getProduct('nope')).resolves.toBeNull();
    await expect(catalog.getProduct('app:nope')).resolves.toBeNull();
  });

  it('pricingModels has plugins and app refs', async () => {
    const models = await setup().catalog.pricingModels();
    expect(models.get('docs')).toBe('MONTHLY');
    expect(models.get('app:warehouse')).toBe('MONTHLY');
  });
});
