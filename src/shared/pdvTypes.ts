export type PdvPaymentMethod = "Dinheiro" | "Debito" | "Credito" | "Pix" | "Outros" | "Nao definido";
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
}

export interface PdvTransferSelection {
  itemId: string;
  quantity: number;
  subtableName?: string;
}

export interface PdvOpenTable {
  id: string;
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
  type: "Venda direta" | "Mesa";
  tableNumber?: number;
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
  settings: PdvSettings;
  dataFile: string;
}

export interface PdvSettings {
  tableCount: number;
  complementsEnabled: boolean;
  subtablesEnabled: boolean;
  tablePeopleEnabled: boolean;
  activePreset: string;
  gridColumns?: number;
  categoryColumns?: number;
  tableColumns?: number;
  productSortDirection?: "az" | "za";
  allowOfflineTables?: boolean;
  productCardHeight?: number;
  categoryCardHeight?: number;
  tableCardHeight?: number;
  stackIdenticalItems?: boolean;
  partialPaymentDescriptionEnabled?: boolean;
  individualUnitItems?: boolean;
  groupComplementsWithProduct?: boolean;
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
