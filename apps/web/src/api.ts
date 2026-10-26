/* Tiny typed API client. Token lives in localStorage; every request carries it.
 * A 401 anywhere raises ApiUnpairedError so the app can drop to the pair screen. */

import type {
  Customer,
  DeviceInfo,
  Movement,
  PairInfo,
  ProductFull,
  ProductSummary,
  Sale,
} from "@inv/shared";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export class ApiUnpairedError extends ApiError {
  constructor() {
    super(401, "unpaired");
  }
}

const TOKEN_KEY = "inv_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* private mode */
  }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function photoUrl(filename: string): string {
  return `/photos/${filename}`;
}

export const photoUrlOf = photoUrl;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (init?.body && typeof init.body === "string") headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "offline");
  }
  if (res.status === 401) {
    clearToken();
    throw new ApiUnpairedError();
  }
  const body: unknown = (await res.json().catch(() => undefined)) ?? undefined;
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Error ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

const jsonBody = (data: unknown): string => JSON.stringify(data);

export const api = {
  /* meta */
  health: () => request<{ ok: boolean; paired: boolean }>("/health"),
  pairInfo: () => request<PairInfo>("/pair-info"),
  pair: (code: string, name: string) =>
    request<{ token: string }>("/pair", { method: "POST", body: jsonBody({ code, name }) }),
  seq: () => request<{ seq: number }>("/seq"),

  /* products */
  products: (q: string, archived = false) =>
    request<ProductSummary[]>(
      `/products?q=${encodeURIComponent(q)}${archived ? "&archived=1" : ""}`
    ),
  product: (id: string) => request<ProductFull>(`/products/${id}`),
  createProduct: (data: unknown) =>
    request<{ id: string }>("/products", { method: "POST", body: jsonBody(data) }),
  patchProduct: (id: string, data: unknown) =>
    request<{ id: string }>(`/products/${id}`, { method: "PATCH", body: jsonBody(data) }),
  archiveProduct: (id: string, archived: boolean) =>
    request<{ ok: boolean }>(`/products/${id}/archive`, {
      method: "POST",
      body: jsonBody({ archived }),
    }),
  deleteProduct: (id: string) => request<{ ok: boolean }>(`/products/${id}`, { method: "DELETE" }),
  history: (id: string) =>
    request<{ movements: Movement[]; sales: Sale[] }>(`/products/${id}/history`),
  sales: (limit = 60) => request<Sale[]>(`/sales?limit=${limit}`),

  /* colors + photos */
  addColor: (productId: string, name: string) =>
    request<{ colorId: number }>(`/products/${productId}/colors`, {
      method: "POST",
      body: jsonBody({ name }),
    }),
  renameColor: (colorId: number, name: string) =>
    request<{ ok: boolean }>(`/colors/${colorId}`, { method: "PATCH", body: jsonBody({ name }) }),
  deleteColor: (colorId: number) =>
    request<{ ok: boolean }>(`/colors/${colorId}`, { method: "DELETE" }),
  uploadPhoto: async (colorId: number, file: File): Promise<{ id: number; filename: string }> => {
    const fd = new FormData();
    fd.append("colorId", String(colorId));
    fd.append("photo", file);
    return request("/photos", { method: "POST", body: fd });
  },
  deletePhoto: (id: number) => request<{ ok: boolean }>(`/photos/${id}`, { method: "DELETE" }),
  reorderPhotos: (photoIds: number[]) =>
    request<{ ok: boolean }>("/photos/reorder", { method: "POST", body: jsonBody({ photoIds }) }),
  attachPhotos: (photoIds: number[], colorId: number) =>
    request<{ ok: boolean }>("/photos/attach", { method: "POST", body: jsonBody({ photoIds, colorId }) }),

  /* movements */
  stockIn: (variantId: number, qty: number, note: string) =>
    request<{ ok: boolean }>("/movements/stock-in", {
      method: "POST",
      body: jsonBody({ variantId, qty, note }),
    }),
  adjust: (variantId: number, setTo: number, note: string) =>
    request<{ ok: boolean }>("/movements/adjust", {
      method: "POST",
      body: jsonBody({ variantId, setTo, note }),
    }),

  /* sales */
  recordSale: (data: unknown) => request<Sale>("/sales", { method: "POST", body: jsonBody(data) }),
  returnSale: (saleId: string, data: unknown) =>
    request<Sale>(`/sales/${saleId}/return`, { method: "POST", body: jsonBody(data) }),

  /* customers */
  customers: (q: string) => request<Customer[]>(`/customers?q=${encodeURIComponent(q)}`),
  customer: (id: string) =>
    request<{ customer: Customer; sales: Sale[] }>(`/customers/${id}`),
  deleteCustomer: (id: string) => request<{ ok: boolean }>(`/customers/${id}`, { method: "DELETE" }),
  createCustomer: (data: unknown) =>
    request<{ id: string }>("/customers", { method: "POST", body: jsonBody(data) }),
  patchCustomer: (id: string, data: unknown) =>
    request<{ ok: boolean }>(`/customers/${id}`, { method: "PATCH", body: jsonBody(data) }),

  /* settings */
  devices: () => request<(DeviceInfo & { tokenTail: string })[]>("/devices"),
  revokeDevice: (id: number) => request<{ ok: boolean }>(`/devices/${id}`, { method: "DELETE" }),
  regenerateCode: () => request<{ code: string }>("/pairing/regenerate", { method: "POST" }),
  settings: () => request<{ shopName: string }>("/settings"),
  patchSettings: (data: unknown) =>
    request<{ ok: boolean }>("/settings", { method: "PATCH", body: jsonBody(data) }),

  /* backup */
  backupStatus: () =>
    request<{ lastRun: number | null; copiedOffAt: number | null; count: number }>(
      "/backup/status"
    ),
  runBackup: () =>
    request<{ lastRun: number | null; copiedOffAt: number | null; count: number }>(
      "/backup/run",
      { method: "POST" }
    ),
  /* one-tap copy to this phone: plain <a download> so the OS wants a user gesture anyway */
};

export function backupDownloadUrl(): string {
  return `/api/backup/latest?t=${getToken() ?? ""}`;
}
