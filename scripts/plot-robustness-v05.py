import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "paper" / "figures"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

BLUE = "#0072B2"       # accepted bundle (= BTS in accepted units)
VERMILLION = "#D55E00"  # pruned Safe-Subset artifact
GREY = "#8C8C8C"        # de-emphasis reference (Direct)
INK = "#262626"
MUTED = "#666666"
GRID = "#DDDDDD"

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Helvetica", "Arial", "DejaVu Sans"],
    "font.size": 7.0,
    "axes.labelsize": 7.0,
    "axes.titlesize": 7.6,
    "xtick.labelsize": 6.4,
    "ytick.labelsize": 6.6,
    "axes.linewidth": 0.6,
    "axes.edgecolor": MUTED,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "text.color": INK,
    "axes.labelcolor": INK,
    "pdf.fonttype": 42,
})

ORGS = [
    ("expense-larkspur", "Larkspur (E)"), ("expense-orchid", "Orchid (E)"),
    ("expense-verbena", "Verbena (E)"), ("access-basalt", "Basalt (A)"),
    ("access-garnet", "Garnet (A)"), ("access-umber", "Umber (A)"),
]

MODELS = [
    {
        "label": "DeepSeek V4 Pro",
        "approval_run_set": "robustness_v05_stress_deepseek-deepseek-v4-pro_hidden_run_set.json",
        "escalation_run_set": "robustness_v05b_stress_deepseek-deepseek-v4-pro_hidden_run_set.json",
        "approval_summary": "robustness_v05_stress_deepseek_hidden_summary.json",
        "escalation_summary": "robustness_v05b_stress_deepseek_hidden_summary.json",
        "violation_note": "52 violations\n(26 units)",
        "violation_xy": (2.13, 0.075), "violation_text_xy": (2.42, 0.12),
    },
    {
        "label": "Gemini 3.7 Flash",
        "approval_run_set": "robustness_v05g_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json",
        "escalation_run_set": "robustness_v05bg_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json",
        "approval_summary": "robustness_v05g_stress_gemini_hidden_summary.json",
        "escalation_summary": "robustness_v05bg_stress_gemini_hidden_summary.json",
        "violation_note": "30 & 32 violations\n(5 & 16 units)",
        "violation_xy": (2.13, 0.09), "violation_text_xy": (1.32, 0.115),
    },
]


def per_org_coverage(run_set_name):
    run_set = json.loads((ROOT / "research" / run_set_name).read_text())
    rows = {}
    for run_id in run_set["runIds"]:
        aggregate = json.loads((ROOT / "runs" / run_id / "aggregate.json").read_text())
        if aggregate["checkpoint"] not in (16, 24, 32):
            continue
        gates = {entry["gate"]: entry for entry in aggregate["gateEvaluations"]}
        row = rows.setdefault(aggregate["organizationId"], {"bundle": [], "subset": []})
        row["bundle"].append(gates["bundle"]["verifiedAutomationCoverage"])
        row["subset"].append(gates["safe-subset"]["verifiedAutomationCoverage"])
    return {
        org: (sum(v["bundle"]) / len(v["bundle"]), sum(v["subset"]) / len(v["subset"]))
        for org, v in rows.items()
    }


def dumbbell(ax, data, title, show_labels):
    ys = range(len(ORGS) - 1, -1, -1)
    for y, (org_id, label) in zip(ys, ORGS):
        bundle, subset = data[org_id]
        ax.plot([subset, bundle], [y, y], color=GRID, lw=1.6, zorder=1, solid_capstyle="round")
        ax.scatter([bundle], [y], s=26, color=BLUE, zorder=3, edgecolors="white", linewidths=0.8)
        ax.scatter([subset], [y], s=26, color=VERMILLION, zorder=3, edgecolors="white", linewidths=0.8)
    ax.set_yticks(list(ys))
    ax.set_yticklabels([label for _, label in ORGS] if show_labels else [""] * len(ORGS))
    ax.set_xlim(-0.03, 1.06)
    ax.set_ylim(-0.7, len(ORGS) - 0.3)
    ax.set_xticks([0, 0.25, 0.5, 0.75, 1.0])
    ax.set_xticklabels(["0", "", "0.5", "", "1"])
    ax.set_title(title, loc="left", fontweight="bold", pad=5)
    ax.tick_params(length=2.2, width=0.6)
    for spine in ("top", "right", "left"):
        ax.spines[spine].set_visible(False)
    ax.tick_params(axis="y", length=0)


def auc_panel(ax, approval_summary, escalation_summary, title, note, note_xy, note_text_xy, show_ylabel):
    gates = ["direct", "bundle", "safe-subset", "bundle-then-subset"]
    gate_labels = ["Direct", "Bundle", "Safe-\nSubset", "BTS"]
    for arm_index, (summary, marker) in enumerate(((approval_summary, "o"), (escalation_summary, "^"))):
        for gate_index, gate in enumerate(gates):
            mean = summary["p2"]["perGate"][gate]["scVacAucClusterMean"]
            org_values = list(summary["p2"]["perGate"][gate]["scVacAucByOrganization"].values())
            x = gate_index + (-0.13 if arm_index == 0 else 0.13)
            color = GREY if gate == "direct" else (VERMILLION if gate == "safe-subset" else BLUE)
            ax.vlines(x, min(org_values), max(org_values), color=color, lw=1.0, alpha=0.55, zorder=2)
            ax.scatter([x], [mean], s=24, marker=marker, color=color, zorder=3,
                       edgecolors="white", linewidths=0.7)
    ax.set_xticks(range(len(gates)))
    ax.set_xticklabels(gate_labels)
    ax.set_xlim(-0.55, len(gates) - 0.45)
    ax.set_ylim(0, 0.85)
    ax.set_yticks([0, 0.2, 0.4, 0.6, 0.8])
    ax.grid(axis="y", color=GRID, lw=0.5, zorder=0)
    ax.set_axisbelow(True)
    ax.set_title(title, loc="left", fontweight="bold", pad=5)
    if show_ylabel:
        ax.set_ylabel("SC-VAC AUC")
    ax.tick_params(length=2.2, width=0.6)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.annotate(note, xy=note_xy, xytext=note_text_xy,
                fontsize=5.8, color=VERMILLION, ha="left", linespacing=1.1,
                arrowprops=dict(arrowstyle="-", color=VERMILLION, lw=0.6))


fig, axes = plt.subplots(
    2, 3, figsize=(7.15, 4.35),
    gridspec_kw={"width_ratios": [1.15, 1.0, 1.05], "wspace": 0.34, "hspace": 0.52},
)

panel_letters = [["a", "b", "c"], ["d", "e", "f"]]
for row, model in enumerate(MODELS):
    approval = per_org_coverage(model["approval_run_set"])
    escalation = per_org_coverage(model["escalation_run_set"])
    approval_summary = json.loads((ROOT / "research" / model["approval_summary"]).read_text())
    escalation_summary = json.loads((ROOT / "research" / model["escalation_summary"]).read_text())
    letters = panel_letters[row]
    ax = axes[row][0]
    dumbbell(ax, approval, f"({letters[0]}) Approval-blind — {model['label']}", show_labels=True)
    if row == 1:
        ax.set_xlabel("Mean hidden coverage")
    ax = axes[row][1]
    dumbbell(ax, escalation, f"({letters[1]}) Escalation-blind", show_labels=False)
    if row == 1:
        ax.set_xlabel("Mean hidden coverage")
    auc_panel(
        axes[row][2], approval_summary, escalation_summary,
        f"({letters[2]}) Safety-constrained AUC",
        model["violation_note"], model["violation_xy"], model["violation_text_xy"],
        show_ylabel=True,
    )

arm_handles = [
    Line2D([], [], marker="o", ls="none", color=INK, markersize=4.4, markerfacecolor="white", markeredgewidth=0.9, label="approval-blind arm"),
    Line2D([], [], marker="^", ls="none", color=INK, markersize=4.4, markerfacecolor="white", markeredgewidth=0.9, label="escalation-blind arm"),
]
series_handles = [
    Line2D([], [], marker="o", ls="none", color=BLUE, markersize=5.0, markeredgecolor="white", markeredgewidth=0.8, label="accepted bundle (= BTS)"),
    Line2D([], [], marker="o", ls="none", color=VERMILLION, markersize=5.0, markeredgecolor="white", markeredgewidth=0.8, label="pruned Safe-Subset artifact"),
]
fig.legend(handles=series_handles + arm_handles, frameon=False, fontsize=6.6, ncol=4,
           loc="upper center", bbox_to_anchor=(0.5, 1.005), handletextpad=0.35, columnspacing=1.2)
fig.subplots_adjust(left=0.085, right=0.995, top=0.885, bottom=0.10)
fig.savefig(OUTPUT_DIR / "robustness_v05.pdf")
fig.savefig(OUTPUT_DIR / "robustness_v05.png", dpi=260)
print(json.dumps({"status": "written", "panels": 6}))
