export interface MergeField {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'object';
  description: string;
  example: string;
}

export interface MergeFieldCategory {
  label: string;
  description: string;
  fields: MergeField[];
}

export const mergeFieldCategories: Record<string, MergeFieldCategory> = {
  company: {
    label: 'Company Information',
    description: 'Tenant/company details auto-injected from tenant config',
    fields: [
      { name: 'company.name', type: 'string', description: 'Company name', example: 'Acme Corp' },
      { name: 'company.logo', type: 'string', description: 'Company logo URL', example: '/uploads/tenant_acme/config/logo.png' },
      { name: 'company.address', type: 'string', description: 'Company address', example: '123 Main Street, Suite 100' },
      { name: 'company.phone', type: 'string', description: 'Company phone number', example: '+1 (555) 123-4567' },
      { name: 'company.email', type: 'string', description: 'Company email address', example: 'info@acmecorp.com' },
      { name: 'company.website', type: 'string', description: 'Company website', example: 'https://acmecorp.com' },
      { name: 'company.taxId', type: 'string', description: 'Tax identification number', example: 'XX-1234567' },
    ],
  },
  invoice: {
    label: 'Invoice',
    description: 'Fields for invoice documents',
    fields: [
      { name: 'invoice.number', type: 'string', description: 'Invoice number', example: 'INV-2026-001' },
      { name: 'invoice.date', type: 'date', description: 'Invoice date', example: '2026-04-09' },
      { name: 'invoice.dueDate', type: 'date', description: 'Payment due date', example: '2026-05-09' },
      { name: 'invoice.status', type: 'string', description: 'Invoice status', example: 'Unpaid' },
      { name: 'customer.name', type: 'string', description: 'Customer name', example: 'John Smith' },
      { name: 'customer.address', type: 'string', description: 'Customer address', example: '456 Oak Avenue' },
      { name: 'customer.email', type: 'string', description: 'Customer email', example: 'john@example.com' },
      { name: 'customer.phone', type: 'string', description: 'Customer phone', example: '+1 (555) 987-6543' },
      { name: 'items', type: 'array', description: 'Line items array (use {{#each items}})', example: '[{name, qty, price, total}]' },
      { name: 'items.$.name', type: 'string', description: 'Item name', example: 'Widget Pro' },
      { name: 'items.$.quantity', type: 'number', description: 'Item quantity', example: '5' },
      { name: 'items.$.unitPrice', type: 'number', description: 'Unit price', example: '29.99' },
      { name: 'items.$.total', type: 'number', description: 'Line total', example: '149.95' },
      { name: 'subtotal', type: 'number', description: 'Subtotal before tax', example: '499.95' },
      { name: 'taxRate', type: 'number', description: 'Tax rate percentage', example: '10' },
      { name: 'taxAmount', type: 'number', description: 'Tax amount', example: '49.99' },
      { name: 'total', type: 'number', description: 'Grand total', example: '549.94' },
      { name: 'notes', type: 'string', description: 'Additional notes', example: 'Payment due within 30 days' },
      { name: 'paymentTerms', type: 'string', description: 'Payment terms', example: 'Net 30' },
    ],
  },
  purchase_order: {
    label: 'Purchase Order',
    description: 'Fields for purchase order documents',
    fields: [
      { name: 'po.number', type: 'string', description: 'PO number', example: 'PO-2026-042' },
      { name: 'po.date', type: 'date', description: 'PO date', example: '2026-04-09' },
      { name: 'po.expectedDelivery', type: 'date', description: 'Expected delivery date', example: '2026-04-20' },
      { name: 'vendor.name', type: 'string', description: 'Vendor/supplier name', example: 'Supply Co Ltd' },
      { name: 'vendor.address', type: 'string', description: 'Vendor address', example: '789 Industrial Blvd' },
      { name: 'vendor.contact', type: 'string', description: 'Vendor contact person', example: 'Jane Doe' },
      { name: 'items', type: 'array', description: 'Order items (use {{#each items}})', example: '[{name, qty, price, total}]' },
      { name: 'subtotal', type: 'number', description: 'Subtotal', example: '1200.00' },
      { name: 'total', type: 'number', description: 'Grand total', example: '1320.00' },
      { name: 'notes', type: 'string', description: 'Special instructions', example: 'Deliver to warehouse B' },
    ],
  },
  delivery_note: {
    label: 'Delivery Note',
    description: 'Fields for delivery note documents',
    fields: [
      { name: 'delivery.number', type: 'string', description: 'Delivery note number', example: 'DN-2026-015' },
      { name: 'delivery.date', type: 'date', description: 'Delivery date', example: '2026-04-09' },
      { name: 'delivery.address', type: 'string', description: 'Delivery address', example: '456 Warehouse St' },
      { name: 'reference.poNumber', type: 'string', description: 'Reference PO number', example: 'PO-2026-042' },
      { name: 'reference.invoiceNumber', type: 'string', description: 'Reference invoice number', example: 'INV-2026-001' },
      { name: 'recipient.name', type: 'string', description: 'Recipient name', example: 'John Smith' },
      { name: 'items', type: 'array', description: 'Delivery items (use {{#each items}})', example: '[{name, qty, unit}]' },
      { name: 'notes', type: 'string', description: 'Delivery notes', example: 'Handle with care' },
    ],
  },
  receipt: {
    label: 'Receipt',
    description: 'Fields for receipt documents',
    fields: [
      { name: 'receipt.number', type: 'string', description: 'Receipt number', example: 'RCP-2026-089' },
      { name: 'receipt.date', type: 'date', description: 'Receipt date', example: '2026-04-09' },
      { name: 'receipt.paymentMethod', type: 'string', description: 'Payment method', example: 'Credit Card' },
      { name: 'receipt.referenceNumber', type: 'string', description: 'Transaction reference', example: 'TXN-4567890' },
      { name: 'customer.name', type: 'string', description: 'Customer name', example: 'John Smith' },
      { name: 'items', type: 'array', description: 'Purchased items (use {{#each items}})', example: '[{name, qty, price, total}]' },
      { name: 'subtotal', type: 'number', description: 'Subtotal', example: '89.97' },
      { name: 'taxAmount', type: 'number', description: 'Tax amount', example: '9.00' },
      { name: 'total', type: 'number', description: 'Total paid', example: '98.97' },
    ],
  },
  credit_note: {
    label: 'Credit Note',
    description: 'Fields for credit note documents',
    fields: [
      { name: 'creditNote.number', type: 'string', description: 'Credit note number', example: 'CN-2026-007' },
      { name: 'creditNote.date', type: 'date', description: 'Credit note date', example: '2026-04-09' },
      { name: 'creditNote.reason', type: 'string', description: 'Reason for credit', example: 'Returned goods' },
      { name: 'reference.invoiceNumber', type: 'string', description: 'Original invoice number', example: 'INV-2026-001' },
      { name: 'customer.name', type: 'string', description: 'Customer name', example: 'John Smith' },
      { name: 'customer.address', type: 'string', description: 'Customer address', example: '456 Oak Avenue' },
      { name: 'items', type: 'array', description: 'Credit items (use {{#each items}})', example: '[{name, qty, price, total}]' },
      { name: 'subtotal', type: 'number', description: 'Subtotal credit', example: '149.95' },
      { name: 'taxAmount', type: 'number', description: 'Tax credit', example: '15.00' },
      { name: 'total', type: 'number', description: 'Total credit', example: '164.95' },
    ],
  },
  common: {
    label: 'Common',
    description: 'Common fields available in all templates',
    fields: [
      { name: 'currentDate', type: 'date', description: 'Current date', example: '2026-04-09' },
      { name: 'currentYear', type: 'string', description: 'Current year', example: '2026' },
      { name: 'currency', type: 'string', description: 'Currency code from tenant config', example: 'USD' },
    ],
  },
};

export function getSampleDataForCategory(category: string): Record<string, unknown> {
  const base = {
    company: {
      name: 'Acme Corporation',
      logo: '/uploads/tenant_demo/config/logo.png',
      address: '123 Main Street, Suite 100\nNew York, NY 10001',
      phone: '+1 (555) 123-4567',
      email: 'info@acmecorp.com',
      website: 'https://acmecorp.com',
      taxId: 'XX-1234567',
    },
    currentDate: new Date().toISOString().split('T')[0],
    currentYear: String(new Date().getFullYear()),
    currency: 'USD',
  };

  const sampleItems = [
    { name: 'Widget Pro', quantity: 5, unitPrice: 29.99, total: 149.95, unit: 'pcs' },
    { name: 'Gadget Plus', quantity: 2, unitPrice: 89.50, total: 179.00, unit: 'pcs' },
    { name: 'Service Package', quantity: 1, unitPrice: 250.00, total: 250.00, unit: 'lot' },
  ];

  const categoryData: Record<string, Record<string, unknown>> = {
    sales: {
      invoice: { number: 'INV-2026-001', date: '2026-04-09', dueDate: '2026-05-09', status: 'Unpaid' },
      customer: { name: 'John Smith', address: '456 Oak Avenue\nLos Angeles, CA 90001', email: 'john@example.com', phone: '+1 (555) 987-6543' },
      items: sampleItems,
      subtotal: 578.95,
      taxRate: 10,
      taxAmount: 57.90,
      total: 636.85,
      notes: 'Thank you for your business!',
      paymentTerms: 'Net 30',
    },
    purchasing: {
      po: { number: 'PO-2026-042', date: '2026-04-09', expectedDelivery: '2026-04-20' },
      vendor: { name: 'Supply Co Ltd', address: '789 Industrial Blvd\nChicago, IL 60601', contact: 'Jane Doe' },
      items: sampleItems,
      subtotal: 578.95,
      total: 636.85,
      notes: 'Deliver to warehouse B',
    },
    inventory: {
      delivery: { number: 'DN-2026-015', date: '2026-04-09', address: '456 Warehouse St\nNew York, NY 10002' },
      reference: { poNumber: 'PO-2026-042', invoiceNumber: 'INV-2026-001' },
      recipient: { name: 'John Smith' },
      items: sampleItems,
      notes: 'Handle with care',
    },
    general: {
      receipt: { number: 'RCP-2026-089', date: '2026-04-09', paymentMethod: 'Credit Card', referenceNumber: 'TXN-4567890' },
      creditNote: { number: 'CN-2026-007', date: '2026-04-09', reason: 'Returned goods' },
      reference: { invoiceNumber: 'INV-2026-001' },
      customer: { name: 'John Smith', address: '456 Oak Avenue\nLos Angeles, CA 90001' },
      items: sampleItems,
      subtotal: 578.95,
      taxAmount: 57.90,
      total: 636.85,
    },
  };

  return { ...base, ...(categoryData[category] || categoryData.sales) };
}
