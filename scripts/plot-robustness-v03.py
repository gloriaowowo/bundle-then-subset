import json
import subprocess
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
with (ROOT / "research" / "robustness_v02_hidden_summary.json").open() as handle:
    v02 = json.load(handle)
with (ROOT / "research" / "robustness_v02_posthoc_hybrid_summary.json").open() as handle:
    v02_hybrid = json.load(handle)
with (ROOT / "research" / "robustness_v03_deepseek_hidden_summary.json").open() as handle:
    v03 = json.load(handle)
with (ROOT / "research" / "robustness_v03_posthoc_domain_behavior.json").open() as handle:
    posthoc = json.load(handle)

OUTPUT_DIR = ROOT / "paper" / "figures"
PDF_PATH = OUTPUT_DIR / "robustness_v03.pdf"
PNG_STEM = OUTPUT_DIR / "robustness_v03"
FONT = "EnterpriseRsiSans"
FONT_BOLD = "EnterpriseRsiSansBold"
pdfmetrics.registerFont(TTFont(FONT, "/System/Library/Fonts/Supplemental/Arial.ttf"))
pdfmetrics.registerFont(TTFont(FONT_BOLD, "/System/Library/Fonts/Supplemental/Arial Bold.ttf"))

v02_gates = {}
for gate in ["bundle", "safe-subset"]:
    rows = [row for row in v02["byMainGateAndRegime"] if row["gate"] == gate]
    v02_gates[gate] = sum(row["meanSafetyConstrainedVacAuc"] for row in rows) / len(rows)
v02_gates["bundle-then-subset"] = v02_hybrid["meanHybridSafetyConstrainedVacAuc"]
v03_gates = {row["gate"]: row["meanSafetyConstrainedVacAuc"] for row in v03["byGate"]}

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
page_width, page_height = 7.15 * 72, 2.58 * 72
chart = canvas.Canvas(str(PDF_PATH), pagesize=(page_width, page_height), initialFontName=FONT)
chart.setTitle("Conservative-first release and domain-dependent evidence timing")
chart.setAuthor("Anonymous")

left_margin, right_margin, panel_gap = 42, 15, 38
bottom, top = 30, page_height - 25
panel_width = (page_width - left_margin - right_margin - panel_gap) / 2
panel_height = top - bottom
ink = HexColor("#2B2B2B")
grid = HexColor("#DDDDDD")
colors = {
    "bundle": HexColor("#0072B2"),
    "safe-subset": HexColor("#E69F00"),
    "bundle-then-subset": HexColor("#009E73"),
}


def title(x0, text):
    chart.setFont(FONT_BOLD, 8.5)
    chart.setFillColor(ink)
    chart.drawCentredString(x0 + panel_width / 2, top + 8, text)


x0, y0 = left_margin, bottom
title(x0, "(a) Conservative-first release transfers")
y_min, y_max = 0.58, 0.73
for value in [0.60, 0.65, 0.70]:
    y = y0 + (value - y_min) / (y_max - y_min) * panel_height
    chart.setStrokeColor(grid)
    chart.setLineWidth(0.45)
    chart.line(x0, y, x0 + panel_width, y)
    chart.setFillColor(HexColor("#666666"))
    chart.setFont(FONT, 6.4)
    chart.drawRightString(x0 - 4, y - 2, f"{value:.2f}")
chart.setStrokeColor(HexColor("#555555"))
chart.line(x0, y0, x0, y0 + panel_height)
chart.line(x0, y0, x0 + panel_width, y0)

groups = [("v0.2 discovery", v02_gates), ("v0.3 fresh confirm", v03_gates)]
gates = ["bundle", "safe-subset", "bundle-then-subset"]
labels = {"bundle": "Bundle", "safe-subset": "Exact subset", "bundle-then-subset": "Bundle-then-subset"}
group_centers = [x0 + panel_width * 0.27, x0 + panel_width * 0.73]
bar_width = 14
for group_index, (group_label, values) in enumerate(groups):
    center = group_centers[group_index]
    for gate_index, gate in enumerate(gates):
        x = center + (gate_index - 1) * (bar_width + 3) - bar_width / 2
        value = values[gate]
        y = y0 + (value - y_min) / (y_max - y_min) * panel_height
        chart.setFillColor(colors[gate])
        chart.rect(x, y0, bar_width, max(0, y - y0), stroke=0, fill=1)
        chart.setFillColor(ink)
        chart.setFont(FONT_BOLD, 6.2)
        chart.drawCentredString(x + bar_width / 2, y + 3, f"{value:.3f}")
    chart.setFont(FONT, 6.6)
    chart.setFillColor(ink)
    chart.drawCentredString(center, y0 - 11, group_label)

for index, gate in enumerate(gates):
    legend_x = x0 + index * 68
    chart.setFillColor(colors[gate])
    chart.rect(legend_x, top - 9, 7, 7, stroke=0, fill=1)
    chart.setFillColor(ink)
    chart.setFont(FONT, 5.9)
    chart.drawString(legend_x + 10, top - 8, labels[gate])
chart.setFont(FONT, 6.0)
chart.setFillColor(HexColor("#666666"))
chart.drawCentredString(x0 + panel_width / 2, 9, "Safety-constrained acquisition AUC (axis starts at 0.58)")

x1 = left_margin + panel_width + panel_gap
title(x1, "(b) Evidence timing is domain-dependent")
axis_min, axis_max = -0.16, 0.16
to_x = lambda value: x1 + (value - axis_min) / (axis_max - axis_min) * panel_width
zero_x = to_x(0)
chart.setStrokeColor(HexColor("#777777"))
chart.setLineWidth(0.7)
chart.line(zero_x, y0 + 10, zero_x, top - 10)
for value in [-0.1, 0.1]:
    chart.setStrokeColor(grid)
    chart.line(to_x(value), y0 + 10, to_x(value), top - 10)

rows = [
    ("Expense gap-1", "expense", "gap1"),
    ("Expense gap-3", "expense", "gap3"),
    ("Access gap-1", "access", "gap1"),
    ("Access gap-3", "access", "gap3"),
]
row_y = [top - 29, top - 55, top - 81, top - 107]
raw_color = HexColor("#0072B2")
violation_color = HexColor("#D55E00")
for (label, domain, gap), y in zip(rows, row_y):
    effects = posthoc["evidenceGapEffectsByDomain"][domain]
    raw = effects[f"{gap}MinusGap0DirectRawAuc"]["estimate"]
    violation = effects[f"{gap}MinusGap0DirectViolationAuc"]["estimate"]
    chart.setFillColor(ink)
    chart.setFont(FONT, 6.5)
    chart.drawString(x1, y + 8, label)
    chart.setStrokeColor(HexColor("#BBBBBB"))
    chart.line(x1, y, x1 + panel_width, y)
    chart.setFillColor(raw_color)
    chart.circle(to_x(raw), y + 2, 3.2, 0, 1)
    chart.setFillColor(violation_color)
    chart.rect(to_x(violation) - 2.7, y - 5.2, 5.4, 5.4, stroke=0, fill=1)
    chart.setFont(FONT_BOLD, 5.8)
    chart.setFillColor(raw_color)
    chart.drawCentredString(to_x(raw), y + 7, f"{raw:+.3f}")
    chart.setFillColor(violation_color)
    chart.drawCentredString(to_x(violation), y - 12, f"{violation:+.3f}")

chart.setFont(FONT, 6.0)
chart.setFillColor(HexColor("#666666"))
for value in [-0.1, 0, 0.1]:
    chart.drawCentredString(to_x(value), y0 - 2, f"{value:+.1f}")
chart.drawCentredString(x1 + panel_width / 2, 9, "Gap minus gap-0 acquisition AUC")
chart.setFillColor(raw_color)
chart.circle(x1 + 52, top - 7, 3, 0, 1)
chart.setFillColor(ink)
chart.drawString(x1 + 59, top - 9, "Raw automation")
chart.setFillColor(violation_color)
chart.rect(x1 + 133, top - 10, 6, 6, stroke=0, fill=1)
chart.setFillColor(ink)
chart.drawString(x1 + 143, top - 9, "Violation exposure")

chart.save()
subprocess.run(
    [
        "/opt/homebrew/bin/pdftoppm",
        "-png",
        "-r",
        "300",
        "-singlefile",
        str(PDF_PATH),
        str(PNG_STEM),
    ],
    check=True,
    stdout=subprocess.DEVNULL,
)
