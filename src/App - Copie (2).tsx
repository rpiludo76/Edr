import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// =============================
// Types
// =============================

type Thresholds = { low: number; medium: number; high: number };

type Settings = {
  scoring: {
    mode: "SP" | "EOA";
    scale: number;
    riskFormula: string; // informational
    thresholds: Thresholds;
  };
};

type ImageInfo = {
  dataUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  displayHeight: number; // fixed 650 in this app
  displayWidth?: number; // computed after layout
};

type LabelInstance = {
  id: string;
  type: string; // danger type
  x?: number; // relative [0..1]
  y?: number; // relative [0..1]
  note?: string;
};

type Row = {
  id: string;
  labelId?: string;
  danger: string;
  position?: string; // e.g., "x=0.62,y=0.41"
  scenario?: string;
  S?: number | "";
  P?: number | "";
  R?: number; // computed
  measures?: string;
  Sr?: number | "";
  Pr?: number | "";
  Rr?: number; // computed
  comments?: string;
  status?: "À évaluer" | "En cours" | "Réduit" | "Accepté";
  owner?: string;
  dueDate?: string; // ISO yyyy-mm-dd
};

type ProjectState = {
  schemaVersion: number;
  meta: { title: string; createdAt: string };
  settings: Settings;
  image: ImageInfo;
  labels: LabelInstance[];
  rows: Row[];
};

// =============================
// Utils
// =============================

const nowIso = () => new Date().toISOString();
const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 9)}`;

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function computeR(S?: number | "", P?: number | "") {
  if (S === "" || P === "" || S == null || P == null) return undefined;
  const s = Number(S);
  const p = Number(P);
  if (Number.isNaN(s) || Number.isNaN(p)) return undefined;
  return s * p;
}

function riskBadgeClass(value: number | undefined, thresholds: Thresholds) {
  if (value == null) return "bg-gray-200 text-gray-800";
  if (value <= thresholds.low) return "bg-green-200 text-green-900";
  if (value <= thresholds.medium) return "bg-amber-200 text-amber-900";
  return "bg-red-200 text-red-900";
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: Row[]) {
  const headers = [
    "ID",
    "Danger",
    //"Position",
    "Scénario",
    "S",
    "P",
    "R",
    "Mesures",
    "Sr",
    "Pr",
    "Rr",
    "Commentaires",
    //"Statut",
    //"Responsable",
    //"Échéance",
  ];
  const lines = rows.map((r) =>
    [
      r.id,
      r.danger ?? "",
      //r.position ?? "",
      r.scenario ?? "",
      r.S ?? "",
      r.P ?? "",
      r.R ?? "",
      r.measures ?? "",
      r.Sr ?? "",
      r.Pr ?? "",
      r.Rr ?? "",
      r.comments ?? "",
      //r.status ?? "",
      //r.owner ?? "",
      //r.dueDate ?? "",
    ]
      .map((cell) =>
        typeof cell === "string"
          ? '"' + cell.replaceAll('"', '""') + '"'
          : String(cell)
      )
      .join(",")
  );
  return [headers.join(","), ...lines].join("\n");
}

// Default library of hazards
const DEFAULT_HAZARDS = [
  "Écrasement",
  "Cisaillement",
  "Coupure/Sectionnement",
  "Entraînement/Engrenage",
  "Impact/Heurt",
  "Projection/Chute d’objet",
  "Perforation",
  "Coincement",
  "Chute de personne",
  "Bruit",
  "Vibration",
  "Température élevée (brûlure)",
  "Température basse",
  "Électricité (choc)",
  "Substance dangereuse (chimique)",
  "Rayonnement",
  "Atmosphère explosive",
];

// =============================
// Component
// =============================

export default function App() {
  const [project, setProject] = useState<ProjectState>(() => ({
    schemaVersion: 1,
    meta: { title: "Evaluation des Risques machine", createdAt: nowIso() },
    settings: {
      scoring: {
        mode: "SP",
        scale: 5,
        riskFormula: "R=S*P",
        thresholds: { low: 5, medium: 12, high: 25 },
      },
    },
    image: { displayHeight: 650 },
    labels: [],
    rows: [],
  }));

  const [library, setLibrary] = useState<string[]>(DEFAULT_HAZARDS);
  const [filter, setFilter] = useState("");
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Keep displayWidth in sync when image loads or container resizes
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const update = () => {
      setProject((p) => ({
        ...p,
        image: {
          ...p.image,
          displayWidth: img.clientWidth || img.naturalWidth,
          naturalWidth: img.naturalWidth || p.image.naturalWidth,
          naturalHeight: img.naturalHeight || p.image.naturalHeight,
        },
      }));
    };
    if (img.complete) update();
    img.addEventListener("load", update);
    const ro = new ResizeObserver(update);
    ro.observe(img);
    return () => {
      img.removeEventListener("load", update);
      ro.disconnect();
    };
  }, [project.image.dataUrl]);

  // =============================
  // Topbar actions
  // =============================

  const onNew = () => {
    setProject({
      schemaVersion: 1,
      meta: { title: "Projet EN12100", createdAt: nowIso() },
      settings: project.settings,
      image: { displayHeight: 650 },
      labels: [],
      rows: [],
    });
    setSelectedLabelId(null);
    setSelectedRowId(null);
    setError(null);
  };

  const onSave = () => {
    const json = JSON.stringify(project, null, 2);
    downloadText(`${project.meta.title || "projet"}.json`, json);
  };

  const onOpen = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[1] ?? input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        // basic permissive validation
        if (!data || typeof data !== "object") throw new Error("Fichier invalide");
        setProject((prev) => ({
          schemaVersion: 1,
          meta: data.meta ?? prev.meta,
          settings: data.settings ?? prev.settings,
          image: { displayHeight: 650, ...(data.image || {}) },
          labels: Array.isArray(data.labels) ? data.labels : [],
          rows: Array.isArray(data.rows) ? data.rows : [],
        }));
        setError(null);
      } catch (e: any) {
        setError("Échec d'ouverture du projet: " + (e?.message || e));
      }
    };
    input.click();
  };

  const onExportCsv = () => {
    const csv = toCsv(project.rows.map(enrichRowComputed));
    downloadText(`${project.meta.title || "projet"}.csv`, csv);
  };

  // =============================
  // Image import
  // =============================

  const importLocalImage = (file: File) => {
    const fr = new FileReader();
    fr.onload = () => {
      setProject((p) => ({
        ...p,
        image: {
          ...p.image,
          dataUrl: String(fr.result),
        },
      }));
    };
    fr.onerror = () => setError("Impossible de lire le fichier image.");
    fr.readAsDataURL(file);
  };

  const importRemoteImage = async (url: string) => {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const fr = new FileReader();
      fr.onload = () => {
        setProject((p) => ({
          ...p,
          image: { ...p.image, dataUrl: String(fr.result) },
        }));
      };
      fr.onerror = () => setError("Impossible de lire l'image téléchargée.");
      fr.readAsDataURL(blob);
    } catch (e) {
      setError(
        "Échec du chargement distant (CORS). Téléchargez l'image localement puis déposez-la."
      );
    }
  };

  const onDropImage = (e: React.DragEvent) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    setError(null);
    if (dt.files && dt.files.length) {
      const file = Array.from(dt.files).find((f) => f.type.startsWith("image/"));
      if (file) return importLocalImage(file);
    }
    const url = dt.getData("text/uri-list") || dt.getData("text/plain");
    if (url) importRemoteImage(url.trim());
  };

  const onPasteImageUrl = async () => {
    const url = prompt("Coller une URL d'image (http/https)");
    if (url) await importRemoteImage(url);
  };

  // =============================
  // Labels: library drag & drop to canvas
  // =============================

  const handleLibraryDragStart = (e: React.DragEvent, danger: string) => {
    e.dataTransfer.setData("text/plain", danger);
  };

  const handleCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const createRowForLabel = (label: LabelInstance) => {
    const rowId = uid("R");
    const position =
      typeof label.x === "number" && typeof label.y === "number"
        ? `x=${label.x.toFixed(2)},y=${label.y.toFixed(2)}`
        : undefined;
    const newRow: Row = {
      id: rowId,
      labelId: label.id,
      danger: label.type,
      //position,
      scenario: "",
      S: "",
      P: "",
      R: undefined,
      measures: "",
      Sr: "",
      Pr: "",
      Rr: undefined,
      comments: "",
      //status: "À évaluer",
      //owner: "",
      //dueDate: "",
    };
    setProject((p) => ({ ...p, rows: [...p.rows, newRow] }));
    setSelectedRowId(rowId);
  };

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const danger = e.dataTransfer.getData("text/plain");
    if (!danger) return;

    const container = canvasRef.current;
    const img = imgRef.current;
    if (!container || !img) return;

    const rect = img.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);

    const label: LabelInstance = { id: uid("L"), type: danger, x, y };
    setProject((p) => ({ ...p, labels: [...p.labels, label] }));
    setSelectedLabelId(label.id);
    createRowForLabel(label);
  };

  // Drop to the side area (outside image) — still creates a row, no coordinates
  const sideDropRef = useRef<HTMLDivElement | null>(null);
  const handleSideDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const danger = e.dataTransfer.getData("text/plain");
    if (!danger) return;
    const label: LabelInstance = { id: uid("L"), type: danger };
    setProject((p) => ({ ...p, labels: [...p.labels, label] }));
    setSelectedLabelId(label.id);
    createRowForLabel(label);
  };

  // =============================
  // Label dragging (reposition)
  // =============================

  const onStartMoveLabel = (
    e: React.MouseEvent,
    labelId: string
  ) => {
    e.stopPropagation();
    setSelectedLabelId(labelId);
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const x = clamp01((ev.clientX - rect.left) / rect.width);
      const y = clamp01((ev.clientY - rect.top) / rect.height);
      setProject((p) => ({
        ...p,
        labels: p.labels.map((lb) => (lb.id === labelId ? { ...lb, x, y } : lb)),
        rows: p.rows.map((r) =>
          r.labelId === labelId
            ? { ...r, position: `x=${x.toFixed(2)},y=${y.toFixed(2)}` }
            : r
        ),
      }));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const deleteLabel = (labelId: string) => {
    // Ask whether to remove linked row(s)
    const linked = project.rows.filter((r) => r.labelId === labelId);
    let removeRows = false;
    if (linked.length) {
      removeRows = confirm(
        `Supprimer ${linked.length} ligne(s) liée(s) au marqueur ? (OK = supprimer aussi les lignes, Annuler = conserver)`
      );
    }
    setProject((p) => ({
      ...p,
      labels: p.labels.filter((l) => l.id !== labelId),
      rows: removeRows ? p.rows.filter((r) => r.labelId !== labelId) : p.rows,
    }));
    setSelectedLabelId(null);
  };

  // =============================
  // Table editing
  // =============================

  function enrichRowComputed(row: Row): Row {
    const R = computeR(row.S, row.P);
    const Rr = computeR(row.Sr, row.Pr);
    return { ...row, R, Rr };
  }

  const updateRow = (rowId: string, patch: Partial<Row>) => {
    setProject((p) => ({
      ...p,
      rows: p.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
    }));
  };

  const linkJumpToLabel = (labelId?: string) => {
    if (!labelId) return;
    setSelectedLabelId(labelId);
    // focus visually by briefly animating? (simple scroll into view)
    const el = document.getElementById(labelId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // =============================
  // Render
  // =============================

  const filteredLibrary = useMemo(
    () =>
      library.filter((x) =>
        x.toLowerCase().includes(filter.trim().toLowerCase())
      ),
    [library, filter]
  );

  return (
    <div className="w-full min-h-screen bg-neutral-50 text-neutral-900">      
      {/* Topbar */}
      <div className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur p-2 flex items-center gap-2">
        <input
          className="px-2 py-1 border rounded-md"
          value={project.meta.title}
          onChange={(e) =>
            setProject((p) => ({ ...p, meta: { ...p.meta, title: e.target.value } }))
          }
          aria-label="Titre du projet"
        />
        <div className="flex gap-2 ml-2">
          <button className="btn" onClick={onNew}>Nouveau</button>
          <button className="btn" onClick={onOpen}>Ouvrir .json</button>
          <button className="btn" onClick={onSave}>Enregistrer .json</button>
          <button className="btn" onClick={onExportCsv}>Exporter CSV</button>
          <button className="btn" onClick={onPasteImageUrl}>Importer URL image</button>
        </div>
        <div className="ml-auto text-sm text-neutral-500">
          EN12100 — R = S × P, seuils: faible ≤ {project.settings.scoring.thresholds.low}, moyen ≤ {project.settings.scoring.thresholds.medium}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="m-3 p-3 rounded-md bg-amber-100 text-amber-900 border border-amber-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-3 p-3">
        {/* Sidebar */}
        <aside className="col-span-3 xl:col-span-2 bg-white rounded-2xl shadow p-3 flex flex-col">
          <div className="font-semibold mb-2">Étiquettes de danger</div>
          <input
            className="w-full mb-2 px-2 py-1 border rounded"
            placeholder="Rechercher..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtrer les étiquettes"
          />
          <div className="flex gap-2 mb-2">
            <input
              id="newLabelInput"
              className="flex-1 px-2 py-1 border rounded"
              placeholder="Ajouter une étiquette..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) {
                    setLibrary((lib) => Array.from(new Set([...lib, val])));
                    (e.target as HTMLInputElement).value = "";
                  }
                }
              }}
            />
            <button
              className="btn"
              onClick={() => {
                const input = document.getElementById(
                  "newLabelInput"
                ) as HTMLInputElement | null;
                if (!input) return;
                const val = input.value.trim();
                if (val) {
                  setLibrary((lib) => Array.from(new Set([...lib, val])));
                  input.value = "";
                }
              }}
            >
              Ajouter
            </button>
          </div>

          <div
            ref={sideDropRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleSideDrop}
            className="min-h-24 p-2 border rounded mb-2 text-sm text-neutral-600"
            aria-label="Déposer ici pour créer une ligne sans position"
          >
            Déposez une étiquette ici (hors image)
          </div>

          <div className="flex-1 overflow-auto pr-1">
            {filteredLibrary.map((haz) => (
              <div
                key={haz}
                className="select-none cursor-grab active:cursor-grabbing mb-2 inline-flex items-center gap-2 px-2 py-1 rounded-full border bg-neutral-50 hover:bg-neutral-100"
                draggable
                onDragStart={(e) => handleLibraryDragStart(e, haz)}
                aria-grabbed="false"
                role="button"
                title="Glisser sur l'image pour créer un marqueur et une ligne"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {haz}
              </div>
            ))}
          </div>
        </aside>

        {/* Canvas + Table */}
        <main className="col-span-9 xl:col-span-10 flex flex-col gap-3">
          {/* Canvas */}
          <div
            ref={canvasRef}
            className="relative bg-white rounded-2xl shadow p-3 flex flex-col"
            onDragOver={handleCanvasDragOver}
            onDrop={handleCanvasDrop}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold">Image de la machine</div>
              <div className="text-sm text-neutral-500">Hauteur fixe 650 px, largeur proportionnelle</div>
            </div>

            {!project.image.dataUrl ? (
              <div
                onDrop={onDropImage}
                onDragOver={(e) => e.preventDefault()}
                className="h-[650px] border-2 border-dashed rounded-xl flex items-center justify-center text-neutral-500"
                aria-label="Zone de dépôt d'image"
              >
                Glissez-déposez une image (fichier ou depuis le web),
                ou utilisez « Importer URL image ».
              </div>
            ) : (
              <div className="relative w-full">
                <img
                  ref={imgRef}
                  id="machine-image"
                  src={project.image.dataUrl}
                  alt="Machine"
                  className="block mx-auto h-[650px] object-contain select-none"
                  draggable={false}
                />

                {/* Labels overlay */}
                {project.labels.map((lb) => {
                  const isSelected = lb.id === selectedLabelId;
                  const hasPos = typeof lb.x === "number" && typeof lb.y === "number";
                  if (!hasPos) return null; // side labels not shown on image
                  const style: React.CSSProperties = {
                    position: "absolute",
                    top: `${(lb.y! * 100).toFixed(2)}%`,
                    left: `${(lb.x! * 100).toFixed(2)}%`,
                    transform: "translate(-50%, -50%)",
                    zIndex: isSelected ? 10 : 5,
                  };
                  return (
                    <button
                      key={lb.id}
                      id={lb.id}
                      style={style}
                      className={
                        "px-2 py-1 rounded-full shadow border bg-white/90 hover:bg-white outline-none focus:ring " +
                        (isSelected ? "ring-2 ring-emerald-500" : "")
                      }
                      onMouseDown={(e) => onStartMoveLabel(e, lb.id)}
                      onClick={() => setSelectedLabelId(lb.id)}
                      title={lb.type}
                    >
                      <span className="inline-flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 rounded-full bg-emerald-600" />
                        {lb.type}
                        <span
                          className="ml-2 text-neutral-400 hover:text-red-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteLabel(lb.id);
                          }}
                          title="Supprimer l'étiquette"
                        >
                          ×
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Risk Table */}
          <div className="bg-white rounded-2xl shadow p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold">Évaluation des risques</div>
              <div className="text-sm text-neutral-500">
                {project.rows.length} ligne(s)
              </div>
            </div>
            <div className="overflow-auto">
              <table className="min-w-full border text-sm">
                <thead className="bg-neutral-100 sticky top-0">
                  <tr>
                    {[
                      "ID",
                      "Danger",
                      //"Position",
                      "Scénario",
                      "S",
                      "P",
                      "R",
                      "Mesures",
                      "Sr",
                      "Pr",
                      "Rr",
                      "Commentaires",
                      //"Statut",
                      //"Responsable",
                      //"Échéance",
                      "↔",
                    ].map((h) => (
                      <th key={h} className="border px-2 py-1 text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {project.rows.map((r) => {
                    const row = enrichRowComputed(r);
                    const isSelected = r.id === selectedRowId;
                    return (
                      <tr
                        key={r.id}
                        className={isSelected ? "bg-emerald-50" : ""}
                        onClick={() => setSelectedRowId(r.id)}
                      >
                        <td className="border px-2 py-1 whitespace-nowrap">{r.id}</td>
                        <td className="border px-2 py-1 min-w-[180px]">
                          <input
                            className="w-full"
                            value={r.danger}
                            onChange={(e) => updateRow(r.id, { danger: e.target.value })}
                          />
                        </td>
                        <td className="border px-2 py-1 min-w-[220px]">
                          <input
                            className="w-full"
                            value={r.scenario ?? ""}
                            onChange={(e) => updateRow(r.id, { scenario: e.target.value })}
                          />
                        </td>
                        <td className="border px-2 py-1 w-16">
                          <input
                            type="number"
                            min={1}
                            max={project.settings.scoring.scale}
                            className="w-16"
                            value={r.S ?? ""}
                            onChange={(e) =>
                              updateRow(r.id, { S: e.target.value === "" ? "" : Number(e.target.value) })
                            }
                          />
                        </td>
                        <td className="border px-2 py-1 w-16">
                          <input
                            type="number"
                            min={1}
                            max={project.settings.scoring.scale}
                            className="w-16"
                            value={r.P ?? ""}
                            onChange={(e) =>
                              updateRow(r.id, { P: e.target.value === "" ? "" : Number(e.target.value) })
                            }
                          />
                        </td>
                        <td className="border px-2 py-1 w-24">
                          <span
                            className={
                              "inline-block px-2 py-1 rounded text-center " +
                              riskBadgeClass(row.R, project.settings.scoring.thresholds)
                            }
                          >
                            {row.R ?? "—"}
                          </span>
                        </td>
                        <td className="border px-2 py-1 min-w-[200px]">
                          <input
                            className="w-full"
                            value={r.measures ?? ""}
                            onChange={(e) => updateRow(r.id, { measures: e.target.value })}
                          />
                        </td>
                        <td className="border px-2 py-1 w-16">
                          <input
                            type="number"
                            min={1}
                            max={project.settings.scoring.scale}
                            className="w-16"
                            value={r.Sr ?? ""}
                            onChange={(e) =>
                              updateRow(r.id, { Sr: e.target.value === "" ? "" : Number(e.target.value) })
                            }
                          />
                        </td>
                        <td className="border px-2 py-1 w-16">
                          <input
                            type="number"
                            min={1}
                            max={project.settings.scoring.scale}
                            className="w-16"
                            value={r.Pr ?? ""}
                            onChange={(e) =>
                              updateRow(r.id, { Pr: e.target.value === "" ? "" : Number(e.target.value) })
                            }
                          />
                        </td>
                        <td className="border px-2 py-1 w-24">
                          <span
                            className={
                              "inline-block px-2 py-1 rounded text-center " +
                              riskBadgeClass(row.Rr, project.settings.scoring.thresholds)
                            }
                          >
                            {row.Rr ?? "—"}
                          </span>
                        </td>
                        <td className="border px-2 py-1 min-w-[200px]">
                          <input
                            className="w-full"
                            value={r.comments ?? ""}
                            onChange={(e) => updateRow(r.id, { comments: e.target.value })}
                          />
                        </td>
                        <td className="border px-2 py-1 w-16 text-center">
                          <button
                            className="text-emerald-700 underline"
                            title="Aller au marqueur lié"
                            onClick={() => linkJumpToLabel(r.labelId)}
                          >
                            Voir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer actions / schema + save */}
          <div className="text-xs text-neutral-500 pb-8">
            Données locales uniquement. Aucun envoi réseau. Pensez à enregistrer votre projet au format JSON.
          </div>
        </main>
      </div>

      <style>{`
        .btn { @apply px-3 py-1.5 border rounded-md shadow-sm bg-white hover:bg-neutral-50 active:scale-[.99]; }
      `}</style>
    </div>
  );
}
