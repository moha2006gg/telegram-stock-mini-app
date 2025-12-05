export const LOCALES = {
  en: 'en',
  ar: 'ar',
  cn: 'cn'
};

const strings = {
  en: {
    title: 'Stock Manager',
    inventory: 'Inventory',
    scan: 'Scan',
    warehouses: 'Warehouses',
    add: 'Add Item',
    qty: 'Qty',
    sku: 'SKU',
    warehouse: 'Warehouse',
    view3d: '3D Preview'
  },
  ar: {
    title: 'مدير المخزون',
    inventory: 'المخزون',
    scan: 'المسح',
    warehouses: 'المخازن',
    add: 'إضافة منتج',
    qty: 'الكمية',
    sku: 'الرمز',
    warehouse: 'المخزن',
    view3d: 'عرض ثلاثي الأبعاد'
  },
  cn: {
    title: '库存管理',
    inventory: '库存',
    scan: '扫描',
    warehouses: '仓库',
    add: '添加物品',
    qty: '数量',
    sku: '货号',
    warehouse: '仓库',
    view3d: '3D 预览'
  }
};

export function t(locale, key){
  return (strings[locale] && strings[locale][key]) || strings.en[key] || key;
}
