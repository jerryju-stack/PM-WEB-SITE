"""Read-only P01 evidence. Python 3.10+ standard library. Reads saved workbook values."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP, getcontext
from functools import lru_cache
from io import BytesIO
from itertools import accumulate
from pathlib import Path
from zipfile import ZipFile

HERE = Path(__file__).resolve().parent
DICTIONARY = json.loads((HERE / "metric-dictionary.json").read_text(encoding="utf-8"))
MATRIX = json.loads((HERE / "source-matrix.json").read_text(encoding="utf-8"))
TOL = {key: Decimal(value) for key, value in DICTIONARY["policy"]["absoluteTolerance"].items()}
getcontext().prec = 46
D = Decimal
ZERO = D(0)
ONE = D(1)
K = D(1000)
SS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


class EvidenceError(Exception):
    pass


class Checks:
    def __init__(self):
        self.counts = Counter()

    def require(self, group, condition, location):
        if not condition:
            raise EvidenceError(f"{group} / {location}")
        self.counts[group] += 1

    def close(self, group, calculated, control, location, unit="money_in_thousands"):
        self.require(group, abs(calculated - control) <= TOL[unit], location)


def display(value, digits=2):
    return format(value.quantize(ONE.scaleb(-digits), rounding=ROUND_HALF_UP), "f")


def present_value(cash, rate):
    if rate is None or None in cash:
        return None, "missing_input"
    if rate <= -ONE:
        return None, "invalid_rate"
    result = ZERO
    for payment in reversed(cash):
        result = payment + result / (ONE + rate)
    return result, "ok"


def reference_irr(cash):
    nonzero = [payment for payment in cash if payment]
    changes = sum((a > 0) != (b > 0) for a, b in zip(nonzero, nonzero[1:]))
    if not changes:
        return None, "no_irr"
    if changes > 1:
        return None, "ambiguous_irr"

    # Solve for the positive discount factor. Leading zero periods leave the root unchanged.
    payments = cash[next(i for i, amount in enumerate(cash) if amount):]

    def polynomial(factor):
        value = ZERO
        for payment in reversed(payments):
            value = value * factor + payment
        return value

    low, high = ZERO, ONE
    for _ in range(256):
        if polynomial(high) * payments[0] <= 0:
            break
        high *= 2
    else:
        return None, "solver_failed"
    for _ in range(180):
        middle = (high + low) / 2
        value = polynomial(middle)
        if value == 0:
            break
        if value * payments[0] > 0:
            low = middle
        else:
            high = middle
    rate = ONE / middle - ONE
    residual, _ = present_value(cash, rate)
    if abs(residual) > TOL["money_in_major_currency"]:
        return None, "solver_failed"
    return rate, "ok"


def cash_controls(cash, rate):
    cumulative = list(accumulate(cash))
    peak = max(ZERO, -min(cumulative))
    peak_period = cumulative.index(-peak) if peak else None
    payback, status = (None, "not_recovered") if peak else (ZERO, "no_funding_required")
    for t in range(1, len(cash)):
        if cumulative[t - 1] < 0 <= cumulative[t]:
            payback = D(t - 1) - cumulative[t - 1] / cash[t]
            status = "recrossed" if any(v < 0 for v in cumulative[t + 1:]) else "ok"
            break
    irr, irr_status = reference_irr(cash)
    npv, _ = present_value(cash, rate)
    return dict(npv=npv, irr=irr, irrStatus=irr_status, payback_period=payback,
                paybackStatus=status, peak_funding_requirement=peak, peakPeriod=peak_period)


def public_controls(check):
    metrics = DICTIONARY["metrics"]
    sources = MATRIX["sources"]
    check.require("contract", DICTIONARY["version"] == MATRIX["version"], "version")
    members = [key for group in DICTIONARY["groups"] for key in group["metrics"]]
    check.require("contract", len(DICTIONARY["groups"]) == 6 and len(members) == len(set(members)), "groups")
    for key in members:
        check.require("contract", key in metrics and metrics[key].get("example"), key)
    for key, metric in metrics.items():
        check.require("contract", metric["sources"] and all(s in sources for s in metric["sources"])
                      and metric["mapping"] in DICTIONARY["mappingStates"]
                      and metric["format"] in DICTIONARY["formats"], key)
    for key, source in sources.items():
        check.require("contract", all(source.get(f) for f in ("scope", "period", "unit", "owners", "evidence", "trace"))
                      and source["status"] in MATRIX["notation"]["status"] and isinstance(source["measured"], bool)
                      and (bool(source["refs"]) or source["status"] == "to_collect"), key)
    examples = DICTIONARY["examples"]
    case = examples["portfolio"]
    rows = case["products"]
    cash = [sum(map(D, payments)) for payments in zip(*(p["cash"] for p in rows), strict=True)]
    sales = sum(p["sold"] * D(p["price"]) for p in rows)
    profit = sales - sum(D(p["approvedFullCosts"]) for p in rows)
    result = cash_controls(cash, D(case["annualRate"]))
    result.update(revenue=sales, operating_profit=profit, operating_margin=profit / sales)
    for key, expected in case["expectedDisplay"].items():
        style = metrics[key]["format"]
        multiplier = DICTIONARY["formats"][style]["multiplier"]
        digits = DICTIONARY["policy"]["displayDecimals"][style]
        check.require("public_examples", display(result[key] * multiplier, digits) == expected, key)
    check.require("public_examples", result["peakPeriod"] == case["peakPeriod"], "peakPeriod")
    for i, edge in enumerate(examples["cashEdges"]):
        result = cash_controls(list(map(D, edge["cash"])), D(case["annualRate"]))
        location = f"cashEdges[{i}]"
        for field in ("irrStatus", "paybackStatus"):
            check.require("public_edges", result[field] == edge.get(field, "ok"), location + "." + field)
        for field, metric, multiplier in (("irr", "irr", 100), ("payback", "payback_period", 1)):
            actual = result[metric]
            check.require("public_edges", (display(actual * multiplier) if actual is not None else None)
                          == edge.get(field), location + "." + field)
        check.require("public_edges", result["peak_funding_requirement"] == D(edge["peak"])
                      and result["peakPeriod"] == edge["peakPeriod"], location + ".peak")
    for i, edge in enumerate(examples["rateEdges"]):
        cash = [None if v is None else D(v) for v in edge["cash"]]
        value, state = present_value(cash, None if edge["rate"] is None else D(edge["rate"]))
        check.require("public_edges", state == edge.get("state", "ok") and
                      (display(value) if value is not None else None) == edge.get("npv"), f"rateEdges[{i}]")


def load_sample(search_root):
    configured = os.environ.get("CQA_SAMPLE_XLSX")
    fingerprint = MATRIX["sample"]["sha256"]
    if configured:
        blob = Path(configured).read_bytes()
        if hashlib.sha256(blob).hexdigest() != fingerprint:
            raise EvidenceError("CQA_SAMPLE_XLSX 文件指纹与 P01 冻结版不符")
        return blob
    if search_root is None:
        raise EvidenceError("请设置 CQA_SAMPLE_XLSX 或用 --search-root 指定获准的样本目录")
    result = subprocess.run(["rg", "--files", "-0", "-g", "*.xlsx", str(search_root)],
                            capture_output=True, check=False)
    if result.returncode not in (0, 1):
        raise EvidenceError("无法搜索样本目录。可设置 CQA_SAMPLE_XLSX 指向冻结原件")
    for name in sorted(filter(None, result.stdout.decode("utf-8").split("\0"))):
        blob = Path(name).read_bytes()
        if hashlib.sha256(blob).hexdigest() == fingerprint:
            return blob
    raise EvidenceError("未找到与 P01 指纹相符的样本。可设置 CQA_SAMPLE_XLSX")


def col_number(letters):
    value = 0
    for letter in letters:
        value = value * 26 + ord(letter) - ord("A") + 1
    return value


def col_name(index):
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(ord("A") + remainder) + name
    return name


@lru_cache(maxsize=None)
def coordinates(address):
    ends = address.split(":")
    start, stop = [re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", ref) for ref in (ends[0], ends[-1])]
    return tuple(f"{col_name(c)}{r}" for r in range(int(start[2]), int(stop[2]) + 1)
                 for c in range(col_number(start[1]), col_number(stop[1]) + 1))


class Snapshot:
    """Only cached OOXML cells, with an explicit distinction between blanks and failed formulas."""
    def __init__(self, archive):
        self.archive = archive
        wb = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        parts = {r.get("Id"): r.get("Target") for r in rels}
        self.parts = {s.get("name"): parts[s.get(REL)] for s in wb.find(SS + "sheets")}
        self.states = {s.get("name"): s.get("state", "visible") for s in wb.find(SS + "sheets")}
        self.strings = ["".join(t.text or "" for t in e.iter(SS + "t"))
                        for e in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        self.sheets = {}

    def cells(self, name):
        if name not in self.sheets:
            part = self.parts[name]
            root = ET.fromstring(self.archive.read(part.lstrip("/") if part.startswith("/") else "xl/" + part))
            cells = {}
            for e in root.iter(SS + "c"):
                raw, kind = e.findtext(SS + "v"), e.get("t", "n")
                if raw in (None, "") and e.find(SS + "f") is not None:
                    cells[e.get("r")] = ("missing_cache", None)
                    continue
                if raw is not None:
                    if kind == "s":
                        raw = self.strings[int(raw)]
                    elif kind == "n" and raw != "":
                        raw = D(raw)
                elif e.find(SS + "f") is None:
                    continue
                cells[e.get("r")] = (kind, raw)
            self.sheets[name] = cells
        return self.sheets[name]

    def num(self, sheet, cell, sum_blank=False):
        record = self.cells(sheet).get(cell)
        if record and isinstance(record[1], D) and record[1].is_finite():
            return record[1]
        # Only for explicit Excel SUM operands or known Year 0 template blanks.
        if sum_blank and (record is None or (record[0] in ("s", "str") and
                                             isinstance(record[1], str) and not record[1].strip())):
            return ZERO
        raise EvidenceError(f"缺少有效数值缓存 {sheet}!{cell}")

    def ref(self, source, field, product=None):
        sheet, address = MATRIX["sources"][source]["refs"][field].rsplit("!", 1)
        return (product if sheet == "@fin" else sheet), address

    def series(self, source, field, product=None):
        sheet, address = self.ref(source, field, product)
        return [self.num(sheet, cell) for cell in coordinates(address)]

    def one(self, source, field, product=None):
        sheet, address = self.ref(source, field, product)
        return self.num(sheet, address)


def verify_scope(book, check):
    sample = MATRIX["sample"]
    products = {p["sheet"] for p in MATRIX["products"].values()}
    bom_sheets = {b["sheet"] for b in MATRIX["marketBoms"].values()}
    used = set()
    for sheet in book.parts:
        if not sheet.startswith("Financials "):
            continue
        volume = book.series("volume", "incrementalVolume", sheet)
        flows = book.series("local_cash", "usd", sheet)
        if any(volume):
            used.add(sheet)
        else:
            check.require("scope", book.states[sheet] == "hidden" and not any(flows), sheet)
    check.require("scope", used == products and len(used) == 4, "active products")
    for key, source in MATRIX["sources"].items():
        for location in source["refs"].values():
            name, address = location.rsplit("!", 1)
            sheets = products if name == "@fin" else bom_sheets if name == "@bom" else [name]
            for sheet in sheets:
                check.require("source_ranges", any(c in book.cells(sheet) for c in coordinates(address)),
                              f"{key} / {sheet}!{address}")
    num_links = sum(bool(re.fullmatch(r"xl/externalLinks/externalLink[0-9]+\.xml", n))
                    for n in book.archive.namelist())
    check.require("scope", num_links == sample["externalLinkParts"], "external link inventory")
    for sheet in sorted(products):
        for field in ("fullYears", "incrementalYears", "volumeYears"):
            _, address = book.ref("calendar", field, sheet)
            raw = [book.cells(sheet)[c][1] for c in coordinates(address)]
            check.require("scope", raw == sample["calendarLabels"], f"{sheet}!{address}")
        check.require("scope", book.cells(sheet)["B11"][1] == sample["localCurrency"], f"{sheet}!B11")
    check.require("scope", book.cells("Exec Sum ")["C91"][1] == sample["execCurrency"], "Exec Sum !C91")
    check.require("scope", book.series("calendar", "operatingYears") == sample["calendarLabels"][1:],
                  "Exec Sum !E91:N91")
    check.require("scope", book.series("calendar", "cashPeriods") == list(range(11)), "Exec Sum !D179:N179")


def verify_control_pin(book, check):
    pin = MATRIX["controlPin"]
    records = []
    selected = [(MATRIX["products"][key]["sheet"], pin["productRefs"])
                for key in sorted(MATRIX["products"])]
    for product, fields in [*selected, (None, pin["projectRefs"])]:
        for path in fields:
            source, field = path.split(".")
            sheet, address = book.ref(source, field, product)
            for cell in coordinates(address):
                records.append([sheet, cell, format(book.num(sheet, cell), "f")])
    payload = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    check.require("control_pin", len(records) == pin["numericCells"], "cell count")
    check.require("control_pin", digest == pin["sha256"], "private control cells")
    return digest


def integer_pieces(thousands):
    # Remove only OOXML numeric serialization noise when decoding forecast whole pieces.
    pieces = thousands * K
    nearest = pieces.to_integral_value(rounding=ROUND_HALF_UP)
    if abs(pieces - nearest) > D("0.0000001"):
        raise EvidenceError("销量千件无法无损还原为整件")
    return int(nearest)


def verify_product_inputs(book, check, key, product):
    sheet = product["sheet"]
    def n(cell, blank=False):
        return book.num(sheet, cell, blank)

    tooling = ZERO
    for bom in (b for b in MATRIX["marketBoms"].values() if b["product"] == key):
        source = bom["sheet"]
        for field, tolerance in (("landed", "unit_price"), ("tooling", "money_in_major_currency")):
            total = sum(book.num(source, c, sum_blank=True) for c in coordinates(bom[field + "Lines"]))
            check.close("bom", total, book.num(source, bom[field + "Total"]),
                        f"{source}!{bom[field + 'Total']}", tolerance)
        check.close("bom", book.num(source, bom["landedTotal"]), n(bom["financialMaterialCell"]),
                    f"{sheet}!{bom['financialMaterialCell']}", "unit_price")
        tooling += book.num(source, bom["toolingTotal"])
    check.close("bom", tooling / K, n("C517"), f"{sheet}!C517")

    rate_sheet = "Hourly Rate"
    rate_col = next(c for c in "BCDEFGHIJKLMNOP" if book.num(rate_sheet, c + "2") == n("E369"))
    factory = book.cells(sheet)["B3"][1]
    rate_row = next(r for r in range(3, 13) if book.cells(rate_sheet).get(f"A{r}", (None, None))[1] == factory)
    rate = book.num(rate_sheet, f"{rate_col}{rate_row}")
    check.close("line_labor_oh", rate, n("D590"), f"{sheet}!D590", "unit_price")
    for first, line in zip((594, 599), product["lineRows"], strict=True):
        staff = book.num("AME", f"E{line}")
        seconds = book.num("AME", f"F{line}") * product["cyclesPerUnit"]
        check.require("line_labor_oh", staff == n(f"C{first}") and seconds == n(f"C{first + 1}"),
                      f"{sheet}!C{first}:C{first + 1}")
        efficiency = n(f"D{first}")
        factor = ONE / efficiency if efficiency > 0 else ONE + n(f"D{first + 1}")
        check.close("line_labor_oh", staff * seconds * rate * factor / 3600, n(f"C{first + 2}"),
                    f"{sheet}!C{first + 2}", "unit_price")
    labor = sum(n(f"C{r}") for r in (596, 601, 606, 611, 616, 621, 626, 631, 636, 638))
    check.close("line_labor_oh", labor, n("C640"), f"{sheet}!C640", "unit_price")
    check.close("line_labor_oh", labor, n("E392"), f"{sheet}!E392", "unit_price")
    voh, foh = product["overheadRows"]
    discount = book.one("fx", "termDiscount")
    for i, col in enumerate("EFGHIJKLMN"):
        old_col = col_name(col_number("H") + min(i, 2))
        check.close("line_labor_oh", book.num("OH-2017", old_col + str(voh)), n(col + "399"),
                    f"{sheet}!{col}399", "unit_price")
        check.close("line_labor_oh", book.num("OH-2017", old_col + str(foh)) + n(col + "377") * discount,
                    n(col + "406"), f"{sheet}!{col}406", "unit_price")

    pm_total = sum(book.num("PM", f"{c}{r}", sum_blank=True) for r in product["pmRows"] for c in "GIJK")
    q426 = book.one("engineering", "total", sheet)
    check.close("development", pm_total / K, q426, f"{sheet}!Q426")
    check.close("development", sum(book.series("engineering", "timing", sheet)), q426, f"{sheet}!D426:N426")
    for col, share in (("D", "R"), ("E", "S")):
        check.close("development", q426 * n(share + "426"), n(col + "426"), f"{sheet}!{col}426")


def verify_development(book, check):
    # The EU conversion includes a case-specific adjustment embedded in the PM formula.
    pm_part = book.parts["PM"]
    root = ET.fromstring(book.archive.read("xl/" + pm_part))
    formula = root.find(f".//{SS}c[@r='I4']/{SS}f").text
    match = re.fullmatch(r"'DV cost'!X9\*EUR/(\d+(?:\.\d+)?)", formula)
    check.require("development", match is not None, "PM!I4 / EUR")
    eu_to_cny = book.one("fx", "cnyPerEur") / D(match[1])
    for pm, budget, divisor in [(2,10,2), (4,9,1), (6,10,2), (8,12,2), (9,11,1),
                                (10,12,2), (11,13,1), (12,14,1)]:
        for target, ws, col, fx in (("I","DV cost","X",eu_to_cny), ("J","DV cost","AE",ONE),
                                    ("K","PV cost","Y",ONE)):
            check.close("development", book.num(ws, f"{col}{budget}") * fx / divisor,
                        book.num("PM", f"{target}{pm}"), f"PM!{target}{pm}", "money_in_major_currency")
    for sheet, cols in (("DV cost", ("X", "AE")), ("PV cost", ("Y",))):
        for col in cols:
            check.close("development", sum(book.num(sheet, f"{col}{r}") for r in range(9, 15)),
                        book.num(sheet, f"{col}15"), f"{sheet}!{col}15", "money_in_major_currency")
    controls = sum(book.num("PM", col + "14") for col in "GIJK") / K
    check.close("development", sum(book.one("engineering", "total", p["sheet"])
                                   for p in MATRIX["products"].values()), controls, "PM!G14:K14")


def build_product_control(book, check, product):
    sheet = product["sheet"]
    def n(cell, blank=False):
        return book.num(sheet, cell, blank)

    local = book.series("local_cash", "local", sheet)
    usd = book.series("local_cash", "usd", sheet)
    k_sales = [ZERO, *book.series("full_pl", "sales", sheet)]
    k_dvp = [ZERO, *book.series("full_pl", "dvp", sheet)]
    mpbitri = book.series("full_pl", "mpbitri", sheet)
    cbt = book.series("incremental_pl", "cbt", sheet)
    pieces = [0, *map(integer_pieces, book.series("volume", "volume", sheet))]
    check.require("product_totals", sum(pieces) == integer_pieces(n("P183")), f"{sheet}!P183")
    for i, col in enumerate("DEFGHIJKLMN"):
        check.close("product_cash", sum(n(col + str(r), True) for r in range(338, 343)), local[i], f"{sheet}!{col}343")
        check.close("product_cash", sum(local[:i + 1]), n(col + "344"), f"{sheet}!{col}344")
        check.close("product_cash", local[i] * n(col + "245"), usd[i], f"{sheet}!{col}349")
        check.close("product_cash", n(col + "245") * book.one("fx", "cnyPerUsd"), ONE,
                    f"{sheet}!{col}245", "ratio_as_fraction")
        # M302:N302 are literal spaces after the investment schedule. Row 342 retains a numeric cash control.
        net_capex = n(col + "302", col in "MN")
        check.close("investment_nwc", sum(n(col + str(r), True) for r in range(294, 301)) - n(col + "430", True),
                    net_capex, f"{sheet}!{col}302")
        check.close("investment_nwc", -net_capex, n(col + "342"), f"{sheet}!{col}342")
        nwc = n(col + "323", i == 0)
        previous = n(col_name(col_number(col)-1) + "323", i == 1) if i else ZERO
        check.close("investment_nwc", previous - nwc, n(col + "341"), f"{sheet}!{col}341")
        check.close("product_pl", n(col + "204", i == 0) - n(col + "209", i == 0) - n(col + "210"),
                    mpbitri[i], f"{sheet}!{col}212")
        check.close("product_pl", k_sales[i] - n(col + "285"), cbt[i], f"{sheet}!{col}286")
        engineering = n(col + "426") - n(col + "427", True)
        for row in (210, 284):
            check.close("development", engineering, n(col + str(row)), f"{sheet}!{col}{row}")
        if i:
            input_col = col_name(col_number(col) - 1)
            vol = sum(book.num("Input", f"{input_col}{r}", sum_blank=i > 8) for r in product["volumeInputRows"])
            check.require("commercial", integer_pieces(vol * (ONE + n("K449"))) == pieces[i], f"{sheet}!{col}183")
            check.close("commercial", n(col + "94") * n(col + "183") * (ONE + n("K447")),
                        k_sales[i], f"{sheet}!{col}186")
            check.close("commercial", k_sales[i], n(col + "265"), f"{sheet}!{col}265")
            check.close("product_pl", k_sales[i] - n(col + "190"), k_dvp[i], f"{sheet}!{col}191")
            for unit_row, full_row, cea_row in ((99, 187, 266), (102, 188, 267)):
                cost = n(col + str(unit_row)) * n(col + "183") * (ONE + n("K448"))
                for row in (full_row, cea_row):
                    check.close("product_pl", cost, n(col + str(row)), f"{sheet}!{col}{row}")
            check.close("line_labor_oh", n(col + "193") + n(col + "194"), n(col + "272"),
                        f"{sheet}!{col}272")
            check.close("investment_nwc", sum(n(col + str(r)) for r in (320,321,322)),
                        nwc, f"{sheet}!{col}323")
    life = {"sales":sum(k_sales), "dvp":sum(k_dvp), "mpbitri":sum(mpbitri), "cbt":sum(cbt)}
    for key, address in (("sales", "P186"), ("dvp", "P191"), ("mpbitri", "P212"), ("cbt", "P286")):
        check.close("product_totals", life[key], n(address), f"{sheet}!{address}")
    life["mpbitriMargin"] = life["mpbitri"] / life["sales"]
    life["afterTaxManagementProfit"] = sum(book.series("tax_assets", "earnings", sheet)) + sum(book.series("tax_assets", "signedTax", sheet))
    life["dvpMargin"] = life["dvp"] / life["sales"]
    life["ros"] = life["afterTaxManagementProfit"] / life["sales"]
    life["engineering"] = book.one("engineering", "total", sheet)
    life["netCapex"] = book.one("investment", "totalNet", sheet)
    life["fullEvaPv"] = book.one("tax_assets", "fullEvaPv", sheet)
    life["incrementalEvaPv"] = book.one("tax_assets", "incrementalEvaPv", sheet)
    life["pieces"] = sum(pieces)
    check.close("product_totals", life["mpbitriMargin"], n("P213"), f"{sheet}!P213", "ratio_as_fraction")
    check.close("product_totals", life["afterTaxManagementProfit"] / life["sales"], n("E45") / 100,
                f"{sheet}!E45", "ratio_as_fraction")
    rate = book.one("local_cash", "rate", sheet)
    check.close("returns", rate, book.one("project_cash", "rate"), f"{sheet}!C330", "ratio_as_fraction")
    returns = {}
    for currency, flows, fields in (("CNY", local, ("npv", "irr")), ("USD", usd, ("usdNpv", "usdIrr"))):
        result = cash_controls([v * K for v in flows], rate)
        returns[currency] = result
        check.close("returns", result["npv"] / K, book.one("local_cash", fields[0], sheet), f"{sheet} / {fields[0]}")
        check.close("returns", result["irr"], book.one("local_cash", fields[1], sheet),
                    f"{sheet} / {fields[1]}", "ratio_as_fraction")
    check.close("returns", returns["CNY"]["payback_period"], book.one("local_cash", "payback", sheet),
                f"{sheet}!D346", "years")
    return dict(pieces=pieces, sales=k_sales, dvp=k_dvp, mpbitri=mpbitri, cbt=cbt,
                salesUsd=book.series("full_pl","usdSales",sheet), profitUsd=book.series("full_pl","usdProfit",sheet),
                cashCny=local, cashUsd=usd, life=life, returns=returns)


def verify_project(book, check, products):
    def add(field):
        return [sum(v) for v in zip(*(p[field] for p in products.values()), strict=True)]

    summary = "Exec Sum "
    for name, product in MATRIX["products"].items():
        for col, payment in zip("DEFGHIJKLMN", products[name]["cashUsd"], strict=True):
            cell = col + str(product["cashRow"])
            check.close("exec_cash", payment, book.num(summary, cell), f"{summary}!{cell}")
    cny, usd = add("cashCny"), add("cashUsd")
    pieces, usd_sales, usd_profit = add("pieces"), add("salesUsd"), add("profitUsd")
    cumulative = list(accumulate(usd))
    for i, col in enumerate("DEFGHIJKLMN"):
        def summary_num(row):
            return book.num(summary, col + str(row))
        unused = [summary_num(row) for row in (*range(151, 157), *range(166, 169))]
        check.require("exec_cash", not any(unused) and summary_num(169) == 0, f"{summary}!{col}169")
        check.close("exec_cash", usd[i], summary_num(157), f"{summary}!{col}157")
        check.close("exec_cash", usd[i], summary_num(177), f"{summary}!{col}177")
        check.close("exec_cash", cumulative[i], summary_num(178), f"{summary}!{col}178")
        if i:
            check.require("exec_pl", pieces[i] == integer_pieces(summary_num(92)), f"{summary}!{col}92")
            check.close("exec_pl", usd_sales[i], summary_num(93), f"{summary}!{col}93")
            check.close("exec_pl", usd_profit[i], summary_num(106), f"{summary}!{col}106")
            if usd_sales[i]:
                check.close("exec_pl", usd_profit[i] / usd_sales[i], summary_num(107),
                            f"{summary}!{col}107", "ratio_as_fraction")
            else:
                kind, value = book.cells(summary)[col + "107"]
                check.require("exec_pl", kind == "str" and isinstance(value, str) and not value.strip(),
                              f"{summary}!{col}107 / zero denominator")
    rate = book.one("project_cash", "rate")
    for ref in ("C162", "C174"):
        check.close("returns", book.num(summary, ref), rate, f"{summary}!{ref}", "ratio_as_fraction")
    local_result = cash_controls([k * K for k in cny], rate)
    usd_result = cash_controls([k * K for k in usd], rate)
    check.close("returns", usd_result["npv"] / K, book.one("project_cash", "npv"), "Exec Sum !D182")
    check.close("returns", usd_result["irr"], book.one("project_cash", "irr"), "Exec Sum !D181", "ratio_as_fraction")
    check.close("returns", usd_result["payback_period"], book.one("project_cash", "payback"), "Exec Sum !D180", "years")
    cached = book.series("project_cash", "cumulative")
    check.close("returns", usd_result["peak_funding_requirement"] / K, -min(cached), "Exec Sum !D178:N178")
    check.require("returns", usd_result["peakPeriod"] == cached.index(min(cached)), "Exec Sum !D179:N179")
    life = {field:sum(p["life"][field] for p in products.values())
            for field in ("sales","dvp","mpbitri","afterTaxManagementProfit","cbt","engineering",
                          "netCapex","fullEvaPv","incrementalEvaPv")}
    life.update(pieces=sum(pieces), mpbitriMargin=life["mpbitri"]/life["sales"],
                ros=life["afterTaxManagementProfit"]/life["sales"], dvpMargin=life["dvp"]/life["sales"])
    return {"originalPeriods":MATRIX["sample"]["calendarLabels"], "flowAndProfitScale":"thousands",
            "returnsMoneyScale":"major currency", "ratios":"fraction", "annualDiscountRate":rate,
            "products":products, "fourProductLifeCny":life, "projectCashKcny":cny, "projectCashKusd":usd,
            "projectCumulativeKusd":cumulative, "returnsCny":local_result, "returnsUsd":usd_result}


def private_line_assumptions(book):
    lines = []
    for row in range(31, 37):
        name = book.cells("AME")[f"C{row}"][1]
        line = {"source": f"AME!C{row}:P{row}", "line": name, "measured": False}
        for key, col in (("people", "E"), ("secondsPerCycle", "F"), ("designOee", "G"),
                         ("utilization", "H"), ("existingCostKcny", "I"), ("newLineCount", "K"),
                         ("newLineCostKcny", "L"), ("toolCount", "N"), ("toolCostKcny", "O")):
            cell = col + str(row)
            line[key] = book.num("AME", cell) if cell in book.cells("AME") else None
        lines.append(line)
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--public", action="store_true", help="run the public contract and synthetic examples only")
    mode.add_argument("--private", action="store_true", help="also show actual controls on this authorized terminal")
    parser.add_argument("--search-root", type=Path,
                        help="fallback search directory when CQA_SAMPLE_XLSX is unset")
    args = parser.parse_args()
    check = Checks()
    public_controls(check)
    result = {"contract":DICTIONARY["version"], "mode":"public" if args.public else "pinned-sample"}
    if not args.public:
        with ZipFile(BytesIO(load_sample(args.search_root))) as archive:
            book = Snapshot(archive)
            verify_scope(book, check)
            result["controlSha256"] = verify_control_pin(book, check)
            verify_development(book, check)
            products = {}
            for key, product in MATRIX["products"].items():
                verify_product_inputs(book, check, key, product)
                products[key] = build_product_control(book, check, product)
            private = verify_project(book, check, products)
            if args.private:
                private["lineDesignOnly"] = private_line_assumptions(book)
        result.update(sampleSha256=MATRIX["sample"]["sha256"], products=len(products),
                      periods=len(private["originalPeriods"]), marketBoms=len(MATRIX["marketBoms"]))
        if args.private:
            result["privateControls"] = private
    result.update(status="passed", checks=dict(check.counts))
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    try:
        main()
    except EvidenceError as error:
        sys.exit(f"P01 / {error}")
    except (OSError, subprocess.SubprocessError):
        sys.exit("P01 / 无法读取授权文件或调用 rg。请核对 CQA_SAMPLE_XLSX 或搜索目录。")
