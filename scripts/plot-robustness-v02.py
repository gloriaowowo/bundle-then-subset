import json
import subprocess
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
SUMMARY_PATH = ROOT / "research" / "robustness_v02_hidden_summary.json"
OUTPUT_DIR = ROOT / "paper" / "figures"
PDF_PATH = OUTPUT_DIR / "robustness_v02.pdf"
PNG_STEM = OUTPUT_DIR / "robustness_v02"
FONT = "OrgBootSans"
FONT_BOLD = "OrgBootSansBold"

pdfmetrics.registerFont(TTFont(FONT, "/System/Library/Fonts/Supplemental/Arial.ttf"))
pdfmetrics.registerFont(
    TTFont(FONT_BOLD, "/System/Library/Fonts/Supplemental/Arial Bold.ttf")
)

with SUMMARY_PATH.open() as handle:
    summary = json.load(handle)

fractions = [0, 0.25, 0.5, 0.75, 1]
gap_colors = {
    "gap-0": HexColor("#0072B2"),
    "gap-1": HexColor("#56B4E9"),
    "gap-2": HexColor("#E69F00"),
    "gap-3": HexColor("#D55E00"),
}
curves = {}
aucs = {}
for regime in gap_colors:
    points = sorted(
        [
            item
            for item in summary["byCheckpoint"]
            if item["gate"] == "direct" and item["evidenceRegime"] == regime
        ],
        key=lambda item: item["checkpoint"],
    )
    curves[regime] = [item["meanRawVac"] for item in points]
    aucs[regime] = next(
        item["meanRawVacAuc"]
        for item in summary["byMainGateAndRegime"]
        if item["gate"] == "direct" and item["evidenceRegime"] == regime
    )

h1 = summary["confirmatoryTests"]["H1_safeSubsetMinusBundleSafetyConstrainedVacAuc"]
decomposition = [
    ("Subset rescues rejected bundles", 0.02759415064102565, HexColor("#009E73")),
    ("Subset prunes accepted bundles", -0.032335069444444434, HexColor("#D55E00")),
    ("Net subset - bundle", h1["estimate"], HexColor("#555555")),
]

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
page_width, page_height = 7.15 * 72, 2.62 * 72
chart = canvas.Canvas(
    str(PDF_PATH),
    pagesize=(page_width, page_height),
    initialFontName=FONT,
)
chart.setTitle("OrgBoot robustness: evidence synchronization and promotion granularity")
chart.setAuthor("Anonymous")

left_margin, right_margin, panel_gap = 40, 12, 34
bottom, top = 30, page_height - 25
panel_width = (page_width - left_margin - right_margin - panel_gap) / 2
panel_height = top - bottom


def draw_axes(x0, y0, width, height, x_ticks, y_ticks):
    chart.setStrokeColor(HexColor("#DDDDDD"))
    chart.setLineWidth(0.45)
    for tick in x_ticks:
        chart.line(x0 + tick * width, y0, x0 + tick * width, y0 + height)
    for tick in y_ticks:
        chart.line(x0, y0 + tick * height, x0 + width, y0 + tick * height)
    chart.setStrokeColor(HexColor("#555555"))
    chart.setLineWidth(0.7)
    chart.line(x0, y0, x0 + width, y0)
    chart.line(x0, y0, x0, y0 + height)


# Panel A: acquisition curves under evidence gaps.
x0, y0 = left_margin, bottom
draw_axes(x0, y0, panel_width, panel_height, fractions, fractions)
chart.setFillColor(HexColor("#222222"))
chart.setFont(FONT_BOLD, 8.5)
chart.drawCentredString(x0 + panel_width / 2, top + 8, "(a) Same evidence, different arrival gaps")
chart.setFont(FONT, 6.8)
chart.setFillColor(HexColor("#555555"))
for tick in fractions:
    chart.drawCentredString(x0 + tick * panel_width, y0 - 10, f"{int(tick * 100)}%")
    chart.drawRightString(x0 - 4, y0 + tick * panel_height - 2, f"{int(tick * 100)}%")

for index, regime in enumerate(gap_colors):
    color = gap_colors[regime]
    curve = curves[regime]
    path = chart.beginPath()
    path.moveTo(x0, y0 + curve[0] * panel_height)
    for fraction, value in zip(fractions[1:], curve[1:]):
        path.lineTo(x0 + fraction * panel_width, y0 + value * panel_height)
    chart.setStrokeColor(color)
    chart.setFillColor(color)
    chart.setLineWidth(1.55)
    chart.drawPath(path)
    for fraction, value in zip(fractions, curve):
        chart.circle(x0 + fraction * panel_width, y0 + value * panel_height, 1.7, 0, 1)
    legend_x = x0 + 7 + (index % 2) * 94
    legend_y = top - 10 - (index // 2) * 10
    chart.line(legend_x, legend_y, legend_x + 13, legend_y)
    chart.setFillColor(HexColor("#333333"))
    chart.setFont(FONT, 6.5)
    chart.drawString(legend_x + 17, legend_y - 2, f"{regime}  AUC {aucs[regime]:.3f}")

chart.setFillColor(HexColor("#333333"))
chart.setFont(FONT, 7.0)
chart.drawCentredString(x0 + panel_width / 2, 9, "Observed enterprise evidence")
chart.saveState()
chart.translate(9, y0 + panel_height / 2)
chart.rotate(90)
chart.drawCentredString(0, 0, "Direct raw automation coverage")
chart.restoreState()

# Panel B: confirmatory H1 decomposition.
x1 = left_margin + panel_width + panel_gap
chart.setFillColor(HexColor("#222222"))
chart.setFont(FONT_BOLD, 8.5)
chart.drawCentredString(x1 + panel_width / 2, top + 8, "(b) Why exact subsets do not generalize")
axis_min, axis_max = -0.045, 0.04
to_x = lambda value: x1 + (value - axis_min) / (axis_max - axis_min) * panel_width
zero_x = to_x(0)
chart.setStrokeColor(HexColor("#BBBBBB"))
chart.setLineWidth(0.7)
chart.line(zero_x, y0 + 16, zero_x, top - 5)

bar_y = [top - 31, top - 64, top - 97]
for (label, value, color), y in zip(decomposition, bar_y):
    chart.setFont(FONT, 6.8)
    chart.setFillColor(HexColor("#333333"))
    chart.drawString(x1, y + 9, label)
    chart.setFillColor(color)
    left = min(zero_x, to_x(value))
    chart.rect(left, y - 1, abs(to_x(value) - zero_x), 8, stroke=0, fill=1)
    chart.setFont(FONT_BOLD, 7.0)
    if label.startswith("Net"):
        chart.setFillColor(HexColor("#555555"))
        chart.drawRightString(zero_x - 7, y - 8, f"{value:.3f}")
    elif value >= 0:
        chart.drawString(to_x(value) + 3, y, f"+{value:.3f}")
    else:
        chart.drawRightString(to_x(value) - 3, y, f"{value:.3f}")

ci_low, ci_high = h1["organizationClusterBootstrap95"]
net_y = bar_y[-1] + 3
chart.setStrokeColor(HexColor("#222222"))
chart.setLineWidth(1.0)
chart.line(to_x(ci_low), net_y, to_x(ci_high), net_y)
chart.line(to_x(ci_low), net_y - 3, to_x(ci_low), net_y + 3)
chart.line(to_x(ci_high), net_y - 3, to_x(ci_high), net_y + 3)

chart.setFont(FONT, 6.4)
chart.setFillColor(HexColor("#555555"))
for tick in [-0.04, -0.02, 0, 0.02, 0.04]:
    chart.drawCentredString(to_x(tick), y0 + 2, f"{tick:+.2f}")
chart.drawCentredString(x1 + panel_width / 2, 9, "Contribution to safety-constrained AUC")
chart.setFont(FONT, 6.2)
chart.drawCentredString(
    x1 + panel_width / 2,
    20,
    "46 rescue units (+0.028) are canceled by 219 over-pruning units (-0.032)",
)

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
