import json
import os
import shutil
import subprocess
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
with (ROOT / "research" / "robustness_v03_deepseek_hidden_summary.json").open() as handle:
    v03 = json.load(handle)
with (ROOT / "research" / "robustness_v04_existing_data_diagnostics.json").open() as handle:
    diagnostics = json.load(handle)
with (ROOT / "research" / "robustness_v04_verifier_ablation.json").open() as handle:
    ablation = json.load(handle)

OUTPUT_DIR = ROOT / "paper" / "figures"
PDF_PATH = OUTPUT_DIR / "robustness_v04.pdf"
PNG_STEM = OUTPUT_DIR / "robustness_v04"
FONT = "EnterpriseRsiSans"
FONT_BOLD = "EnterpriseRsiSansBold"


def first_font(env_name, candidates, fallback):
    """Arial on macOS (the paper's figure); other platforms fall back to an
    installed Arial or to the DejaVu Sans font bundled with matplotlib. Only the
    figure PDF's glyphs change; its hash is reported, never enforced."""
    override = os.environ.get(env_name)
    if override:
        return override
    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
    import matplotlib

    return str(Path(matplotlib.get_data_path()) / "fonts" / "ttf" / fallback)


pdfmetrics.registerFont(TTFont(FONT, first_font("BTS_FIGURE_FONT", [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
], "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont(FONT_BOLD, first_font("BTS_FIGURE_FONT_BOLD", [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
], "DejaVuSans-Bold.ttf")))

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
page_width, page_height = 7.15 * 72, 2.35 * 72
chart = canvas.Canvas(str(PDF_PATH), pagesize=(page_width, page_height), initialFontName=FONT, invariant=1)
chart.setTitle("Organization effects, rescue anatomy, and verifier sensitivity")
chart.setAuthor("")

ink = HexColor("#262626")
muted = HexColor("#666666")
grid = HexColor("#D9D9D9")
blue = HexColor("#0072B2")
orange = HexColor("#E69F00")
green = HexColor("#009E73")
grey = HexColor("#9B9B9B")
red = HexColor("#D55E00")

left_margin, right_margin, gap = 22, 8, 18
panel_width = (page_width - left_margin - right_margin - 2 * gap) / 3
bottom, top = 27, page_height - 20


def panel_title(x0, text):
    chart.setFillColor(ink)
    chart.setFont(FONT_BOLD, 7.7)
    chart.drawCentredString(x0 + panel_width / 2, top + 7, text)


# Panel A: organization-level paired effects.
x0 = left_margin
panel_title(x0, "(a) Recovered coverage by organization")
effects = diagnostics["smallClusterRobustness"]["perOrganization"]
labels = ["E1", "E2", "E3", "E4", "A1", "A2", "A3", "A4"]
x_min, x_max = 0, 0.16
plot_left, plot_right = x0 + 21, x0 + panel_width - 5
to_x = lambda value: plot_left + (value - x_min) / (x_max - x_min) * (plot_right - plot_left)
plot_bottom, plot_top = bottom + 10, top - 5
for tick in [0, 0.05, 0.10, 0.15]:
    x = to_x(tick)
    chart.setStrokeColor(grid)
    chart.setLineWidth(0.4)
    chart.line(x, plot_bottom, x, plot_top)
    chart.setFillColor(muted)
    chart.setFont(FONT, 5.6)
    chart.drawCentredString(x, bottom + 1, f"{tick:.2f}")
row_gap = (plot_top - plot_bottom - 13) / 8
for index, (label, item) in enumerate(zip(labels, effects)):
    y = plot_top - 7 - index * row_gap
    chart.setFillColor(muted)
    chart.setFont(FONT, 5.8)
    chart.drawRightString(plot_left - 4, y - 2, label)
    chart.setFillColor(blue if label.startswith("E") else green)
    chart.circle(to_x(item["pairedEffect"]), y, 2.7, stroke=0, fill=1)
estimate = v03["confirmatoryTests"]["H1_hybridMinusBundleSafetyConstrainedVacAuc"]["estimate"]
ci_low, ci_high = v03["confirmatoryTests"]["H1_hybridMinusBundleSafetyConstrainedVacAuc"]["organizationClusterBootstrap95"]
diamond_y = plot_bottom + 2
chart.setStrokeColor(ink)
chart.setLineWidth(1.0)
chart.line(to_x(ci_low), diamond_y, to_x(ci_high), diamond_y)
chart.setFillColor(ink)
chart.saveState()
diamond = chart.beginPath()
diamond.moveTo(to_x(estimate), diamond_y + 3)
diamond.lineTo(to_x(estimate) + 3.5, diamond_y)
diamond.lineTo(to_x(estimate), diamond_y - 3)
diamond.lineTo(to_x(estimate) - 3.5, diamond_y)
diamond.close()
chart.drawPath(diamond, stroke=0, fill=1)
chart.restoreState()
chart.setFont(FONT, 5.6)
chart.setFillColor(muted)
chart.drawString(plot_left, 6, "BTS - Bundle SC-AUC (\u2265 0 by construction)")


# Panel B: aggregate outcomes in subset-recovery units.
x1 = x0 + panel_width + gap
panel_title(x1, "(b) What subset recovery restores")
anatomy = diagnostics["rescueAnatomy"]
segments = [
    ("No match", anatomy["outcomeRates"]["no_rule_match"], grey),
    ("Action", anatomy["outcomeRates"]["action_success"], blue),
    ("Escalate", anatomy["outcomeRates"]["escalation_correct"], orange),
    ("Approve", anatomy["outcomeRates"]["approval_correct"], green),
]
bar_left, bar_right = x1 + 7, x1 + panel_width - 7
bar_y, bar_height = top - 33, 24
cursor = bar_left
for label, value, color in segments:
    width = (bar_right - bar_left) * value
    chart.setFillColor(color)
    chart.rect(cursor, bar_y, width, bar_height, stroke=0, fill=1)
    if width > 22:
        chart.setFillColor(HexColor("#FFFFFF") if color != grey else ink)
        chart.setFont(FONT_BOLD, 5.8)
        chart.drawCentredString(cursor + width / 2, bar_y + 9, f"{100 * value:.1f}%")
    cursor += width
legend_y = bar_y - 15
for index, (label, value, color) in enumerate(segments):
    y = legend_y - index * 13
    chart.setFillColor(color)
    chart.rect(bar_left, y - 1, 6, 6, stroke=0, fill=1)
    chart.setFillColor(ink)
    chart.setFont(FONT, 5.8)
    chart.drawString(bar_left + 9, y, f"{label}: {anatomy['outcomeCounts'][{'No match':'no_rule_match','Action':'action_success','Escalate':'escalation_correct','Approve':'approval_correct'}[label]]}")
chart.setFillColor(ink)
chart.setFont(FONT_BOLD, 6.1)
chart.drawString(bar_left, bottom + 8, "70 units / 874 exposures")
chart.setFillColor(green)
chart.setFont(FONT_BOLD, 6.0)
chart.drawString(bar_left, 6, "42.2% useful; 0 unsafe outcomes")


# Panel C: exhaustive semantic-stratum verifier sensitivity.
x2 = x1 + panel_width + gap
panel_title(x2, "(c) Mean violation AUC, weakened panels")
rows = ablation["bySemanticStratumCount"]
plot_left, plot_right = x2 + 24, x2 + panel_width - 5
plot_bottom, plot_top = bottom + 8, top - 9
to_x2 = lambda value: plot_left + (value - 1) / 5 * (plot_right - plot_left)
y_min, y_max = 0, 0.05
to_y2 = lambda value: plot_bottom + (value - y_min) / (y_max - y_min) * (plot_top - plot_bottom)
for tick in [0, 0.02, 0.04]:
    y = to_y2(tick)
    chart.setStrokeColor(grid)
    chart.setLineWidth(0.4)
    chart.line(plot_left, y, plot_right, y)
    chart.setFillColor(muted)
    chart.setFont(FONT, 5.5)
    chart.drawRightString(plot_left - 4, y - 2, f"{tick:.2f}")
for tick in range(1, 7):
    chart.setFillColor(muted)
    chart.setFont(FONT, 5.5)
    chart.drawCentredString(to_x2(tick), bottom, str(tick))
gate_styles = [
    ("bundle", "Bundle", blue),
    ("safe-subset", "Subset", orange),
    ("bundle-then-subset", "BTS", green),
]
for gate, label, color in gate_styles:
    values = [row["gates"][gate]["meanViolationExposureAuc"] for row in rows]
    chart.setStrokeColor(color)
    chart.setLineWidth(1.2)
    for index in range(1, len(values)):
        chart.line(to_x2(index), to_y2(values[index - 1]), to_x2(index + 1), to_y2(values[index]))
    chart.setFillColor(color)
    for index, value in enumerate(values, start=1):
        chart.circle(to_x2(index), to_y2(value), 2.2, stroke=0, fill=1)
for index, (_, label, color) in enumerate(gate_styles):
    legend_x = x2 + 8 + index * 42
    chart.setStrokeColor(color)
    chart.setLineWidth(1.2)
    chart.line(legend_x, top - 2, legend_x + 8, top - 2)
    chart.setFillColor(ink)
    chart.setFont(FONT, 5.4)
    chart.drawString(legend_x + 10, top - 4, label)
chart.setFillColor(muted)
chart.setFont(FONT, 5.6)
chart.drawCentredString(x2 + panel_width / 2, 6, "Retained semantic strata (means over masks)")

chart.save()
PDFTOPPM = shutil.which("pdftoppm") or "/opt/homebrew/bin/pdftoppm"
if not Path(PDFTOPPM).is_file():
    print("note: pdftoppm not found; skipping the PNG preview (the PDF is the paper figure)")
    raise SystemExit(0)
subprocess.run(
    [
        PDFTOPPM,
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
