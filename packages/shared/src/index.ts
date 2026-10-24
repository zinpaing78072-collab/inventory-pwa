/* Shared types + helpers for the inventory PWA.
 * Money is an integer number of MMK (Kyat), never a float.
 * Product strings (brand/type/name/notes) are free text in v1. */

export type MovementType = "stock-in" | "adjust" | "sale" | "return" | "sale-reverse";

/* ---------- product side ---------- */

export interface SizeDef {
  id: number;
  label: string; // "S" | "M" | "Free" ...
  price: number; // Ks integer, per size (colors share it)
}

export interface ColorDef {
  id: number;
  name: string;
  photoIds: number[];
  photos: PhotoInfo[];
}

export interface PhotoInfo {
  id: number;
  filename: string;
  url?: string; // filled by API layer with token
}

export interface ProductSummary {
  id: string; // nanoid-style
  brand: string;
  type: string;
  name: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  minPrice: number;
  maxPrice: number;
  totalQty: number;
  lowQty: boolean;
  outQty: boolean;
  /** list-route only: first photo filename + name per color, in color order */
  colorNames?: string[];
  thumbs?: string[]; // photo filenames, one per color
}

export interface ProductFull extends ProductSummary {
  sizes: SizeDef[];
  colors: ColorDef[];
  // variant qty lookup keyed "colorId|sizeId"
  qty: Record<string, number>;
  // variant molecule id lookup keyed "colorId|sizeId" (for sale/stock-in/adjust calls)
  variantIds: Record<string, number>;
}

/* ---------- customers / sales ---------- */

export interface Customer {
  id: string;
  name: string;
  phone1: string;
  phone2: string;
  createdAt: number;
}

export interface SaleLine {
  id: number;
  saleId: string;
  variantId: number;
  productId: string;
  productName: string;
  brand: string;
  colorName: string;
  sizeLabel: string;
  qty: number;
  price: number; // unit price at sale time
  returned: number; // units already returned
}

export interface Sale {
  id: string;
  customerId: string | null;
  customerName: string; // snapshot — sales stay readable even if customer edited
  customerPhone: string;
  at: number;
  lines: SaleLine[];
  total: number;
  returnedQty: number;
}

export interface Movement {
  id: number;
  at: number;
  type: MovementType;
  productName: string;
  colorName: string;
  sizeLabel: string;
  delta: number; // signed: +in, -out
  note: string;
  saleId: string | null;
}

export interface ProductHistoryItem {
  movement?: Movement;
  sale?: Sale;
}

/* ---------- device / pairing ---------- */

export interface DeviceInfo {
  id: number;
  name: string;
  createdAt: number;
  lastSeen: number;
}

export interface PairInfo {
  paired: boolean;
  code: string | null;
  shopName: string;
}

/* ---------- requests ---------- */

export interface SaleInput {
  customerId?: string | null;
  customerName: string;
  phone1?: string;
  phone2?: string;
  lines: { variantId: number; qty: number }[];
}

export interface ReturnInput {
  lines: { saleLineId: number; qty: number }[];
  note?: string;
}

export interface ProductInput {
  brand?: string;
  type?: string;
  name: string;
  notes?: string;
  sizes?: { label: string; price: number }[];
  colors?: { name: string; photoIds: number[] }[];
}

export interface StockInInput {
  variantId: number;
  qty: number;
  note?: string;
}

export interface AdjustInput {
  variantId: number;
  setTo: number;
  note?: string;
}

/* ---------- backup ---------- */

export interface BackupStatus {
  lastRun: number | null;
  copiedOffAt: number | null;
  count: number; // snapshots retained on server
}

/* ---------- api envelope ---------- */

export interface ApiError {
  error: string;
}

/* ---------- formatting helpers ---------- */

export function mmk(n: number): string {
  return n.toLocaleString("en-US") + " Ks";
}

export function mmkRange(min: number, max: number): string {
  if (min === max) return mmk(min);
  // "50,000–65,000" without repeating the unit twice
  return formatNoUnit(min) + "–" + formatNoUnit(max) + " Ks";
}

export function formatNoUnit(n: number): string {
  return n.toLocaleString("en-US");
}

export function stockClass(total: number): "out" | "low" | "" {
  return total === 0 ? "out" : total <= 3 ? "low" : "";
}

export function stockText(total: number): string {
  return total === 0 ? "Sold out" : total + " left";
}

export const LOW_QTY_THRESHOLD = 3;
export const DEFAULT_LOW_STOCK = 3;
