import json
import subprocess
from collections import defaultdict
from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
SUMMARY = ROOT / "research" / "hidden_main_summary.json"
OUTPUT_DIR = ROOT / "paper" / "figures"
PDF_PATH = OUTPUT_DIR / "hidden_acquisition_curves.pdf"
PNG_STEM = OUTPUT_DIR / "hidden_acquisition_curves"
COLORS = {
    "C2-direct-workflow": HexColor("#D55E00"),
    "C3-orgboot": HexColor("#0072B2"),
}
LABELS = {
    "C2-direct-workflow": "Direct workflow (C2)",
    "C3-orgboot": "OrgBoot (C3)",
}
FONT_REGULAR = "OrgBootSans"
FONT_BOLD = "OrgBootSansBold"

pdfmetrics.registerFont(
    TTFont(FONT_REGULAR, "/System/Library/Fonts/Supplemental/Arial.ttf")
)
pdfmetrics.registerFont(
    TTFont(FONT_BOLD, "/System/Library/Fonts/Supplemental/Arial Bold.ttf")
)


with SUMMARY.open() as handle:
    summary = json.load(handle)

series_by_condition_org = defaultdict(list)
for series in summary["byExperimentalSeries"]:
    series_by_condition_org[(series["conditionId"], series["organizationId"])].append(series)


def average_curves(field):
    result = defaultdict(dict)
    for (condition, organization), series_list in series_by_condition_org.items():
        curves = [series[field] for series in series_list]
        result[condition][organization] = [
            sum(curve[index] for curve in curves) / len(curves)
            for index in range(len(curves[0]))
        ]
    return result


def blend_with_white(color, amount=0.72):
    return Color(
        color.red + (1 - color.red) * amount,
        color.green + (1 - color.green) * amount,
        color.blue + (1 - color.blue) * amount,
    )


sc_curves = average_curves("safetyConstrainedVac")
raw_curves = average_curves("rawVac")
fractions = summary["byExperimentalSeries"][0]["evidenceFractions"]
auc = {item["conditionId"]: item for item in summary["byCondition"]}

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
page_width, page_height = 7.15 * 72, 2.75 * 72
chart = canvas.Canvas(
    str(PDF_PATH),
    pagesize=(page_width, page_height),
    initialFontName=FONT_REGULAR,
)
chart.setTitle("OrgBoot hidden acquisition curves")
chart.setAuthor("Anonymous")

chart.setFillColor(HexColor("#111111"))
chart.setFont(FONT_BOLD, 10.2)
title = "Safe-subset promotion increases deployable coverage but reduces raw coverage"
chart.drawCentredString(page_width / 2, page_height - 13, title)

left_margin, right_margin, gap = 42, 10, 26
bottom, top = 33, page_height - 31
panel_width = (page_width - left_margin - right_margin - gap) / 2
panel_height = top - bottom


def draw_panel(panel_index, curves, auc_field, panel_title):
    x0 = left_margin + panel_index * (panel_width + gap)
    y0 = bottom
    x = lambda value: x0 + value * panel_width
    y = lambda value: y0 + value * panel_height

    chart.setFont(FONT_BOLD, 8.3)
    chart.setFillColor(HexColor("#222222"))
    chart.drawCentredString(x0 + panel_width / 2, top + 7, panel_title)

    chart.setStrokeColor(HexColor("#DDDDDD"))
    chart.setLineWidth(0.45)
    for tick in fractions:
        chart.line(x(tick), y0, x(tick), top)
        chart.line(x0, y(tick), x0 + panel_width, y(tick))

    chart.setFont(FONT_REGULAR, 6.8)
    chart.setFillColor(HexColor("#444444"))
    for tick in fractions:
        label = f"{round(tick * 100)}%"
        chart.drawCentredString(x(tick), y0 - 10, label)
        if panel_index == 0:
            chart.drawRightString(x0 - 4, y(tick) - 2.2, label)

    chart.setStrokeColor(HexColor("#555555"))
    chart.setLineWidth(0.7)
    chart.line(x0, y0, x0 + panel_width, y0)
    chart.line(x0, y0, x0, top)

    legend_y = top - 10
    for condition_index, condition in enumerate(["C2-direct-workflow", "C3-orgboot"]):
        organization_curves = list(curves[condition].values())
        chart.setStrokeColor(blend_with_white(COLORS[condition]))
        chart.setLineWidth(0.75)
        for curve in organization_curves:
            path = chart.beginPath()
            path.moveTo(x(fractions[0]), y(curve[0]))
            for evidence_fraction, value in zip(fractions[1:], curve[1:]):
                path.lineTo(x(evidence_fraction), y(value))
            chart.drawPath(path)

        mean_curve = [
            sum(curve[index] for curve in organization_curves) / len(organization_curves)
            for index in range(len(fractions))
        ]
        chart.setStrokeColor(COLORS[condition])
        chart.setFillColor(COLORS[condition])
        chart.setLineWidth(1.8)
        path = chart.beginPath()
        path.moveTo(x(fractions[0]), y(mean_curve[0]))
        for evidence_fraction, value in zip(fractions[1:], mean_curve[1:]):
            path.lineTo(x(evidence_fraction), y(value))
        chart.drawPath(path)
        for evidence_fraction, value in zip(fractions, mean_curve):
            chart.circle(x(evidence_fraction), y(value), 2.0, stroke=0, fill=1)

        legend_text = f"{LABELS[condition]} · AUC {auc[condition][auc_field]:.3f}"
        legend_x = x0 + 7
        legend_line_y = legend_y - condition_index * 10
        chart.setLineWidth(1.8)
        chart.line(legend_x, legend_line_y, legend_x + 15, legend_line_y)
        chart.circle(legend_x + 7.5, legend_line_y, 1.6, stroke=0, fill=1)
        chart.setFillColor(HexColor("#333333"))
        chart.setFont(FONT_REGULAR, 6.9)
        chart.drawString(legend_x + 19, legend_line_y - 2.2, legend_text)

    chart.setFillColor(HexColor("#333333"))
    chart.setFont(FONT_REGULAR, 7.4)
    chart.drawCentredString(x0 + panel_width / 2, 13, "Observed enterprise evidence")


draw_panel(0, sc_curves, "meanSafetyConstrainedVacAuc", "(a) Deployable coverage (SC-VAC)")
draw_panel(1, raw_curves, "meanRawVacAuc", "(b) Candidate capability (raw VAC)")

chart.saveState()
chart.translate(10, bottom + panel_height / 2)
chart.rotate(90)
chart.setFillColor(HexColor("#333333"))
chart.setFont(FONT_REGULAR, 7.4)
chart.drawCentredString(0, 0, "Verified automation coverage")
chart.restoreState()

chart.setFont(FONT_REGULAR, 6.2)
chart.setFillColor(HexColor("#666666"))
chart.drawRightString(
    page_width - 10,
    2.5,
    "Thin lines: organization means across 3 repeated calls · Bold lines: equal-weight organization mean",
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
