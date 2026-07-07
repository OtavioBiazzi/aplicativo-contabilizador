export type PdvPaymentMethod = "Dinheiro" | "Debito" | "Credito" | "Pix" | "Outros" | "Nao definido";
export type PdvTableStatus = "Livre" | "Ocupada" | "Fechamento" | "Reservada";

export interface PdvCategory {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface PdvProduct {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  price: number;
  unit: string;
  active: boolean;
  showOnPdv: boolean;
  canBeComplement: boolean;
  hasComplements: boolean;
  sortOrder: number;
}

export interface PdvProductDraft {
  id?: string;
  name: string;
  categoryId: string;
  price: number;
  unit: string;
  active: boolean;
  showOnPdv: boolean;
  canBeComplement: boolean;
  hasComplements: boolean;
  sortOrder: number;
}

export interface PdvCategoryDraft {
  id?: string;
  name: string;
  active: boolean;
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
  unitPrice: number;
  baseUnitPrice?: number;
  discount: number;
  total: number;
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
}

export interface PdvSale {
  id: string;
  createdAt: string;
  type: "Venda direta" | "Mesa";
  tableNumber?: number;
  status: "Finalizada" | "Cancelada" | "Parcial";
  subtotal: number;
  discount: number;
  total: number;
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
  activePreset: string;
}

export interface PdvProductImportResult {
  filePath: string;
  importedProducts: number;
  importedCategories: number;
  skippedRows: number;
}

export interface PdvExportFilters {
  from?: string;
  to?: string;
  type?: "Todos" | PdvSale["type"];
  payment?: "Todos" | PdvPaymentMethod;
  table?: string;
}
