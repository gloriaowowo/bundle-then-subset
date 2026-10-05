"""Camera-ready appendix figure: per-mask paired differences, BTS minus Safe-Subset.

POST-HOC, zero model calls. Reads research/robustness_v04_mask_distribution_per_mask.csv
(written by scripts/posthoc-v04-mask-distribution.mjs) and draws, for each of the 255
verifier-case subsets in the v0.3 DeepSeek replay, the BTS-minus-Safe-Subset change in
mean SC-AUC (x) against the change in mean violation-exposure AUC (y), coloured and
shaped by whether the escalation case D8 is in the panel.

Run: scripts/run-figure-python.sh scripts/plot-mask-paired.py  (or python3 with matplotlib)
Output: paper/figures/mask_paired.pdf (+ .png preview)
"""
import csv
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "research" / "robustness_v04_mask_distribution_per_mask.csv"
OUT_PDF = ROOT / "paper" / "figures" / "mask_paired.pdf"
OUT_PNG = ROOT / "paper" / "figures" / "mask_paired.png"

INK, MUTED, GRID = "#262626", "#666666", "#D9D9D9"
BLUE, VERMILLION = "#0072B2", "#D55E00"  # Okabe-Ito, same hues as the paper's other figures
EPS = 1e-12

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
    "font.size": 7,
    "axes.edgecolor": MUTED,
    "axes.labelcolor": INK,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "pdf.fonttype": 42,
    "svg.fonttype": "none",
})

with CSV_PATH.open() as handle:
    rows = list(csv.DictReader(handle))
if len(rows) != 255:
    raise SystemExit(f"expected 255 masks, found {len(rows)}")


def group(present):
    return [r for r in rows if (r["d8Present"] == "true") == present]


def counts(sel):
    d = [float(r["d_bts_ss_violAuc"]) for r in sel]
    return sum(x < -EPS for x in d), sum(abs(x) <= EPS for x in d), sum(x > EPS for x in d)


def size(n):
    return 12 + 7 * n  # marker area grows with the number of masks at one point


fig, ax = plt.subplots(figsize=(5.2, 2.6))
ax.axhline(0, color=MUTED, linewidth=0.8, zorder=1)
ax.axvline(0, color=GRID, linewidth=0.8, zorder=1)
ax.grid(True, color=GRID, linewidth=0.4, zorder=0)
series_handles = []
for present, color, marker in [(False, BLUE, "o"), (True, VERMILLION, "^")]:
    sel = group(present)
    lower, equal, higher = counts(sel)
    label = (f"D8 (escalation) {'present' if present else 'absent'}: {len(sel)} masks; "
             f"BTS violation lower/equal/higher {lower}/{equal}/{higher}")
    # Many masks give identical per-mask means; draw each distinct point once,
    # sized by how many masks share it.
    stacked = Counter((round(float(r["d_bts_ss_scAuc"]), 9), round(float(r["d_bts_ss_violAuc"]), 9)) for r in sel)
    xs, ys, ns = zip(*[(x, y, n) for (x, y), n in sorted(stacked.items())])
    handle = ax.scatter(xs, ys, s=[size(n) for n in ns], marker=marker, color=color,
                        edgecolor="white", linewidth=0.6, alpha=0.9, label=label, zorder=3)
    series_handles.append(handle)
ax.set_xlabel(r"$\Delta$ mean SC-AUC, BTS $-$ Safe-Subset (right: BTS keeps more safe coverage)")
ax.set_ylabel(r"$\Delta$ mean violation AUC" "\n" r"BTS $-$ Safe-Subset")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
ax.text(0.01, 0.04, "below zero: BTS has lower violation exposure", transform=ax.transAxes,
        ha="left", va="bottom", color=MUTED, fontsize=6)
first = ax.legend(handles=series_handles, loc="upper left", bbox_to_anchor=(0, 1.2), frameon=False,
                  fontsize=6.3, handletextpad=0.3, borderaxespad=0, markerscale=0.8)
ax.add_artist(first)
first.set_clip_on(False)  # add_artist clips to the axes patch; this legend sits above it
for h in first.legend_handles:
    h.set_sizes([28])
size_handles = [ax.scatter([], [], s=size(n), marker="o", color="white", edgecolor=MUTED, linewidth=0.6)
                for n in (1, 7, 21)]
ax.legend(size_handles, ["1", "7", "21"], title="masks at point", title_fontsize=6, fontsize=6,
          loc="center left", frameon=False, handletextpad=0.2, labelspacing=0.9, borderaxespad=0.2,
          bbox_to_anchor=(0.0, 0.36))
fig.tight_layout()
OUT_PDF.parent.mkdir(parents=True, exist_ok=True)
fig.savefig(OUT_PDF, bbox_inches="tight", pad_inches=0.03, metadata={"Title": "Per-mask BTS minus Safe-Subset", "Author": None, "Creator": None, "Producer": None, "CreationDate": None})
fig.savefig(OUT_PNG, dpi=220, bbox_inches="tight", pad_inches=0.03)
print(f"wrote {OUT_PDF.relative_to(ROOT)} and {OUT_PNG.relative_to(ROOT)}")
