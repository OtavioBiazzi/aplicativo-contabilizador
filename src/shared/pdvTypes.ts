export type PdvPaymentMethod = "Dinheiro" | "Debito" | "Credito" | "Pix" | "Outros" | "Nao definido" | "Conta a receber";
export type PdvTableStatus = "Livre" | "Ocupada" | "Fechamento" | "Reservada";
export type PdvUnitMode = "unidade" | "kg" | "grama";

export interface PdvCategory {
  id: string;
  name: string;
  active: boolean;
  favorite: boolean;
  sortOrder: number;
}

export interface PdvProduct {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  price: number;
  unit: string;
  unitMode: PdvUnitMode;
  active: boolean;
  showOnPdv: boolean;
  favorite: boolean;
  canBeComplement: boolean;
  hasComplements: boolean;
  complementProductIds: string[];
  sortOrder: number;
  importSource?: string;
  costPrice?: number;
  trackStock?: boolean;
  stockQuantity?: number;
  minimumStock?: number;
  sku?: string;
  barcode?: string;
  supplier?: string;
  description?: string;
}

export interface PdvProductDraft {
  id?: string;
  name: string;
  categoryId: string;
  price: number;
  unit: string;
  unitMode: PdvUnitMode;
  active: boolean;
  showOnPdv: boolean;
  favorite: boolean;
  canBeComplement: boolean;
  hasComplements: boolean;
  complementProductIds: string[];
  sortOrder: number;
  costPrice?: number;
  trackStock?: boolean;
  stockQuantity?: number;
  minimumStock?: number;
  sku?: string;
  barcode?: string;
  supplier?: string;
  description?: string;
}

export interface PdvProductRemovalResult {
  id: string;
  mode: "deleted" | "archived";
}

export interface PdvCategoryDraft {
  id?: string;
  name: string;
  active: boolean;
  favorite: boolean;
  sortOrder: number;
}

export interface PdvItemComplement {
  productId: string;
  name: string;
  price: number;
}

export interface PdvCartItem {
  id: string;
  productId: string;
  productName: string;
  categoryName: string;
  quantity: number;
  measureLabel?: string;
  unitPrice: number;
  baseUnitPrice?: number;
  discount: number;
  total: number;
  paidQuantity?: number;
  subtableName?: string;
  note?: string;
  complements?: PdvItemComplement[];
}

export interface PdvPayment {
  id: string;
  method: PdvPaymentMethod;
  amount: number;
  received?: number;
  change?: number;
  description?: string;
  customerId?: string;
  customerName?: string;
  dueDate?: string;
}

export interface PdvCustomer {
  id: string;
  name: string;
  document: string;
  phone: string;
  email: string;
  address: string;
  note: string;
  active: boolean;
  createdAt: string;
}

export interface PdvCustomerDraft {
  id?: string;
  name: string;
  document?: string;
  phone?: string;
  email?: string;
  address?: string;
  note?: string;
  active?: boolean;
}

export interface PdvReceivablePayment {
  id: string;
  receivableId: string;
  createdAt: string;
  method: Exclude<PdvPaymentMethod, "Conta a receber">;
  amount: number;
  received?: number;
  change?: number;
  description?: string;
  originDevice?: string;
  operationId?: string;
}

export interface PdvReceivable {
  id: string;
  saleId: string;
  customerId: string;
  customerName: string;
  tableNumber?: number;
  subtableName?: string;
  createdAt: string;
  dueDate?: string;
  originalAmount: number;
  receivedAmount: number;
  balance: number;
  status: "Em aberto" | "Parcialmente recebida" | "Recebida" | "Vencida" | "Cancelada";
  note: string;
  payments: PdvReceivablePayment[];
}

export interface PdvReceivablePatch {
  dueDate?: string;
  note?: string;
  items?: PdvCartItem[];
  payments?: PdvReceivablePayment[];
}

export type PdvPayableStatus = "Em aberto" | "Parcialmente paga" | "Paga" | "Vencida" | "Cancelada";

export interface PdvPayablePayment {
  id: string;
  payableId: string;
  createdAt: string;
  method: Exclude<PdvPaymentMethod, "Conta a receber">;
  amount: number;
  description?: string;
  originDevice?: string;
  operationId?: string;
}

export interface PdvPayable {
  id: string;
  description: string;
  supplier: string;
  category: string;
  documentNumber: string;
  createdAt: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  balance: number;
  status: PdvPayableStatus;
  note: string;
  payments: PdvPayablePayment[];
}

export interface PdvPayableDraft {
  id?: string;
  description: string;
  supplier?: string;
  category?: string;
  documentNumber?: string;
  dueDate: string;
  amount: number;
  note?: string;
  payments?: PdvPayablePayment[];
}

export interface PdvTransferSelection {
  itemId: string;
  quantity: number;
  subtableName?: string;
}

export interface PdvOpenTable {
  id: string;
  sessionId?: string;
  number: number;
  status: PdvTableStatus;
  openedAt: string | null;
  people: number;
  note: string;
  total: number;
  items: PdvCartItem[];
  subtables?: string[];
}

export interface PdvSale {
  id: string;
  createdAt: string;
  type: "Venda direta" | "Mesa" | "Onibus";
  tableNumber?: number;
  tableSessionId?: string;
  status: "Finalizada" | "Cancelada" | "Parcial" | "deleted";
  subtotal: number;
  discount: number;
  total: number;
  description?: string;
  observations?: string;
  originDevice?: string;
  operationId?: string;
  payments: PdvPayment[];
  items: PdvCartItem[];
}

export interface PdvSnapshot {
  categories: PdvCategory[];
  products: PdvProduct[];
  tables: PdvOpenTable[];
  recentSales: PdvSale[];
  customers: PdvCustomer[];
  receivables: PdvReceivable[];
  payables: PdvPayable[];
  settings: PdvSettings;
  dataFile: string;
}

export interface PdvSettings {
  tableCount: number;
  complementsEnabled: boolean;
  subtablesEnabled: boolean;
  rememberLastSubtable?: boolean;
  tablePeopleEnabled: boolean;
  activePreset: string;
  gridColumns?: number;
  categoryColumns?: number;
  tableColumns?: number;
  productSortDirection?: "az" | "za";
  allowOfflineTables?: boolean;
  productCardHeight?: number;
  productFontSize?: number;
  categoryCardHeight?: number;
  tableCardHeight?: number;
  productLookupPageSize?: number;
  stackIdenticalItems?: boolean;
  partialPaymentDescriptionEnabled?: boolean;
  skipPaymentConfirmation?: boolean;
  individualUnitItems?: boolean;
  groupComplementsWithProduct?: boolean;
  roundingStep?: number;
  roundingDirection?: "nearest" | "up" | "down";
  receiptPaperWidth?: "58" | "80" | "a4" | "custom";
  receiptCustomPaperWidthMm?: number;
  receiptCustomPaperHeightMm?: number;
  receiptFontSize?: number;
  receiptMarginLeftMm?: number;
  receiptMarginRightMm?: number;
  receiptMarginTopMm?: number;
  receiptMarginBottomMm?: number;
  receiptAutoPrint?: boolean;
  receiptOpenAfterSale?: boolean;
  receiptPrinterName?: string;
  receiptCopies?: number;
  receiptLogoDataUrl?: string;
  receiptShowLogo?: boolean;
  receiptBusinessName?: string;
  receiptBusinessDocument?: string;
  receiptBusinessStateRegistration?: string;
  receiptBusinessAddress?: string;
  receiptBusinessPhone?: string;
  receiptFooter?: string;
  receiptAllowClientPrint?: boolean;
  receiptGroupIdenticalItems?: boolean;
  receiptUseColor?: boolean;
}

export interface PdvProductImportResult {
  filePath: string;
  importedProducts: number;
  importedCategories: number;
  skippedRows: number;
  updatedProducts?: number;
  removedProducts?: number;
}

export interface PdvProductImportPreview {
  filePath: string;
  categories: number;
  products: number;
  addedProducts: number;
  updatedProducts: number;
  removedProducts: number;
  manualProductsPreserved: number;
  manualConflicts: number;
  ignoredRows: number;
}

export interface PdvExportFilters {
  from?: string;
  to?: string;
  type?: "Todos" | PdvSale["type"];
  payment?: "Todos" | PdvPaymentMethod;
  status?: "Todos" | PdvSale["status"];
  table?: string;
}
