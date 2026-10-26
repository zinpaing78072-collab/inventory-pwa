import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { mmk } from "@inv/shared";
import { api } from "../api";
import { useApp } from "../App";
import { compressImage } from "../components/actions";
import { photoUrlOf } from "../components/util";

/* Add + Edit product in one screen. Strings are free text (v1, per hand-off §4).
 * Photo uploads are compressed client-side, attached to a color (existing) or
 * uploaded unattached first and joined at create time. */

interface DraftColor {
  key: string; // local key (server colorId when editing)
  colorId?: number; // only when editing an existing color
  name: string;
  photos: { url: string; filename: string; id?: number }[];
  uploading: boolean;
}

interface DraftSize {
  id?: number; // server id when editing
  label: string;
  price: number;
}

export default function EditProduct() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { toast, bump, rev } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [brand, setBrand] = useState("");
  const [type, setType] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [archived, setArchived] = useState(false);

  const [colors, setColors] = useState<DraftColor[]>(
    [{ key: "c0", name: "Default", photos: [], uploading: false }]
  );
  const [sizes, setSizes] = useState<DraftSize[]>([{ label: "Free", price: 0 }]);
  const isEdit = !!id;

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const p = await api.product(id);
        setBrand(p.brand);
        setType(p.type);
        setName(p.name);
        setNotes(p.notes);
        setArchived(p.archived);
        setColors(
          p.colors.map((c) => ({
            key: `c${c.id}`,
            colorId: c.id,
            name: c.name,
            photos: c.photos.map((ph) => ({ url: photoUrlOf(ph.filename), filename: ph.filename, id: ph.id })),
            uploading: false,
          }))
        );
        setSizes(p.sizes.map((s) => ({ id: s.id, label: s.label, price: s.price })));
      } catch (e: unknown) {
        setErr(String((e as Error).message ?? e));
      }
    })();
  }, [id, rev]);

  /* ---------------- photos ---------------- */

  const pickPhotos = async (draftColor: DraftColor, files: FileList | null) => {
    if (!files?.length) return;
    setColors((cs) => cs.map((c) => (c.key === draftColor.key ? { ...c, uploading: true } : c)));
    try {
      for (const raw of Array.from(files)) {
        const compressed = await compressImage(raw);
        let filename: string;
        if (isEdit && draftColor.colorId) {
          const up = await api.uploadPhoto(draftColor.colorId, compressed);
          filename = up.filename;
          setColors((cs) =>
            cs.map((c) =>
              c.key === draftColor.key
                ? { ...c, photos: [...c.photos, { url: photoUrlOf(filename), filename }] }
                : c
            )
          );
        } else {
          /* unattached: keep a local object URL for preview; upload deferred to save */
          const pending = await api.uploadPhoto(0, compressed);
          filename = pending.filename;
          setColors((cs) =>
            cs.map((c) =>
              c.key === draftColor.key
                ? {
                    ...c,
                    photos: [...c.photos, { url: URL.createObjectURL(compressed), filename, id: pending.id }],
                  }
                : c
            )
          );
        }
      }
      bump();
    } catch (e: unknown) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setColors((cs) => cs.map((c) => (c.key === draftColor.key ? { ...c, uploading: false } : c)));
    }
  };

  const removePhoto = async (draftColor: DraftColor, index: number) => {
    const ph = draftColor.photos[index];
    setColors((cs) =>
      cs.map((c) => (c.key === draftColor.key ? { ...c, photos: c.photos.filter((_, i) => i !== index) } : c))
    );
    if (ph.id) {
      try {
        await api.deletePhoto(ph.id);
        bump();
      } catch {
        /* orphan cleanup acceptable in v1 */
      }
    }
  };

  const addColor = () => {
    setColors((cs) => [
      ...cs,
      { key: `c${Date.now().toString(36)}`, name: `Color ${cs.length + 1}`, photos: [], uploading: false },
    ]);
  };

  /* ---------------- sizes ---------------- */

  const addSize = () => {
    setSizes((ss) => [...ss, { label: "", price: ss[ss.length - 1]?.price ?? 0 }]);
  };

  /* ---------------- save ---------------- */

  const save = async () => {
    setErr("");
    if (!name.trim()) {
      setErr("Product name is required");
      return;
    }
    if (colors.length === 0) {
      setErr("Add at least one color");
      return;
    }
    if (sizes.some((s) => !s.label.trim() || s.price < 0)) {
      setErr("Each size needs a label and a price ≥ 0");
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await api.patchProduct(id!, {
          brand: brand.trim(),
          type: type.trim(),
          name: name.trim(),
          notes: notes,
          sizes: sizes.map((s) => ({ id: s.id, label: s.label.trim(), price: s.price })),
        });
        for (const c of colors) {
          if (c.colorId) {
            await api.renameColor(c.colorId, c.name.trim() || "Default");
          } else if (c.photos.length || c.name) {
            const { colorId } = await api.addColor(id!, c.name.trim() || "Default");
            const photoIds = c.photos.map((ph) => ph.id ?? 0).filter(Boolean);
            if (photoIds.length) await api.attachPhotos(photoIds, colorId);
          }
        }
        toast("Product updated");
      } else {
        const { id: newId } = await api.createProduct({
          brand: brand.trim(),
          type: type.trim(),
          name: name.trim(),
          notes: notes,
          sizes: sizes.map((s) => ({ label: s.label.trim(), price: s.price })),
          colors: colors.map((c) => ({
            name: c.name.trim() || "Default",
            photoIds: c.photos.map((ph) => ph.id ?? 0).filter(Boolean),
          })),
        });
        toast("Product created");
        nav(`/products/${newId}`, { replace: true });
      }
      bump();
      if (isEdit) nav(`/products/${id}`);
    } catch (e: unknown) {
      setErr(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  const doArchive = async () => {
    if (isEdit) {
      await api.archiveProduct(id!, !archived);
      setArchived(!archived);
      toast(archived ? "Unarchived" : "Archived — hidden from the grid, still searchable");
      bump();
    }
  };

  const doDelete = async () => {
    if (!isEdit || !confirm("Delete this product and its history? This cannot be undone.")) return;
    await api.deleteProduct(id!);
    toast("Product deleted");
    bump();
    nav("/", { replace: true });
  };

  return (
    <>
      <header className="head">
        <div className="head-top">
          <Link to={isEdit ? `/products/${id}` : "/"} style={{ fontSize: 14 }}>
            ‹ Back
          </Link>
        </div>
      </header>

      <div className="detail-wrap">
        <h3 style={{ margin: "0 0 6px" }}>{isEdit ? "Edit product" : "New product"}</h3>

        <div className="frow">
          <label>Name</label>
          <input value={name} placeholder="Satin maxi gown" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="frow f2">
          <div>
            <label>Brand</label>
            <input value={brand} placeholder="ZARA" onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div>
            <label>Type</label>
            <input value={type} placeholder="Dress" onChange={(e) => setType(e.target.value)} />
          </div>
        </div>
        <div className="frow">
          <label>Notes</label>
          <textarea rows={2} value={notes} placeholder="Supplier, care, anything" onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="chips-label">Colors & photos</div>
        {colors.map((c, ci) => (
          <div className="card" key={c.key}>
            <div className="flexrow">
              <input
                style={{ flex: 1, border: "1px solid var(--hairline)", borderRadius: 9, padding: "7px 10px", fontSize: 14 }}
                value={c.name}
                onChange={(e) =>
                  setColors((cs) => cs.map((x) => (x.key === c.key ? { ...x, name: e.target.value } : x)))
                }
                placeholder="Color name"
              />
              {colors.length > 1 && (
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (isEdit && c.colorId) void api.deleteColor(c.colorId).then(bump);
                    setColors((cs) => cs.filter((_, i) => i !== ci));
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <div className="chips" style={{ marginTop: 8 }}>
              {c.photos.map((ph, i) => (
                <button
                  key={ph.filename + i}
                  style={{ borderRadius: 10, overflow: "hidden", position: "relative", width: 76, height: 95 }}
                >
                  <img src={ph.url} width={76} height={95} style={{ objectFit: "cover", width: "100%", height: "100%" }} />
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      void removePhoto(c, i);
                    }}
                    style={{
                      position: "absolute",
                      top: 3,
                      right: 3,
                      background: "rgba(27,26,23,.6)",
                      color: "#fff",
                      borderRadius: "50%",
                      width: 18,
                      height: 18,
                      fontSize: 11,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    ✕
                  </span>
                </button>
              ))}
              <label
                style={{
                  width: 76,
                  height: 95,
                  border: "1px dashed var(--hairline)",
                  borderRadius: 10,
                  display: "grid",
                  placeItems: "center",
                  alignContent: "center",
                  gap: 4,
                  color: "var(--muted)",
                  fontSize: 18,
                  cursor: "pointer",
                }}
              >
                📷
                <span style={{ fontSize: 9 }}>Camera</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => void pickPhotos(c, e.target.files).then(() => (e.target.value = ""))}
                />
              </label>
              <label
                style={{
                  width: 76,
                  height: 95,
                  border: "1px dashed var(--hairline)",
                  borderRadius: 10,
                  display: "grid",
                  placeItems: "center",
                  alignContent: "center",
                  gap: 4,
                  color: "var(--muted)",
                  fontSize: 20,
                  cursor: "pointer",
                }}
              >
                ＋
                <span style={{ fontSize: 9 }}>Gallery</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => void pickPhotos(c, e.target.files).then(() => (e.target.value = ""))}
                />
              </label>
            </div>
          </div>
        ))}
        <button className="btn small" style={{ marginTop: 8 }} onClick={addColor}>
          + Add color
        </button>

        <div className="chips-label" style={{ marginTop: 16 }}>
          Sizes & prices (Ks, per size)
        </div>
        {sizes.map((s, si) => (
          <div className="qty-edit-row" key={si} style={{ gridTemplateColumns: "1fr 110px 34px" }}>
            <input
              style={{ border: "1px solid var(--hairline)", borderRadius: 9, padding: "7px 10px" }}
              value={s.label}
              placeholder="S / M / L / Free"
              onChange={(e) => setSizes((arr) => arr.map((x, i) => (i === si ? { ...x, label: e.target.value } : x)))}
            />
            <input
              type="number"
              inputMode="numeric"
              min={0}
              style={{ border: "1px solid var(--hairline)", borderRadius: 9, padding: "7px 6px", textAlign: "right", background: "var(--panel)" }}
              value={s.price || ""}
              placeholder="0"
              onChange={(e) =>
                setSizes((arr) => arr.map((x, i) => (i === si ? { ...x, price: Math.max(0, Number(e.target.value) || 0) } : x)))
              }
            />
            <button
              className="step"
              title="Remove size"
              onClick={() => setSizes((arr) => arr.filter((_, i) => i !== si))}
              disabled={sizes.length <= 1}
            >
              ✕
            </button>
          </div>
        ))}
        <button className="btn small" style={{ marginTop: 8 }} onClick={addSize}>
          + Add size
        </button>

        {isEdit && (
          <div className="card">
            <h4>Danger zone</h4>
            <div className="chips">
              <button className="btn small" onClick={doArchive}>
                {archived ? "Unarchive" : "Archive (sold out / gone)"}
              </button>
              <button className="btn small danger" onClick={doDelete}>
                Delete product
              </button>
            </div>
          </div>
        )}

        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: "100%", marginTop: 16 }} onClick={save} disabled={busy}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create product"}
        </button>
      </div>
    </>
  );
}
