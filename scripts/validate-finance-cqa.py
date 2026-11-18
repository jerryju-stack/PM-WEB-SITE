"""Independent, read-only P05 import checks. Standard-library Decimal; no external refresh."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP, localcontext
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("p01", ROOT / "docs/validation/project-finance/P01/verify.py")
p01 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p01)


def validate(source, candidate_path):
    blob = Path(source).read_bytes()
    candidate_bytes = Path(candidate_path).read_bytes()
    candidate = json.loads(candidate_bytes)
    snapshot = candidate["snapshot"]
    fingerprint = hashlib.sha256(blob).hexdigest()
    if fingerprint != candidate["sourceSha256"] or fingerprint != p01.MATRIX["sample"]["sha256"]:
        raise ValueError("Source fingerprint mismatch")
    check = p01.Checks()
    anomalies = []
    with ZipFile(BytesIO(blob)) as archive:
        book = p01.Snapshot(archive)
        p01.verify_scope(book, check)
        control_sha = p01.verify_control_pin(book, check)
        p01.verify_development(book, check)
        products = {}
        for key, product in p01.MATRIX["products"].items():
            p01.verify_product_inputs(book, check, key, product)
            products[key] = p01.build_product_control(book, check, product)
        controls = p01.verify_project(book, check, products)
        raw_sheets = {}
        for sheet in {s["sheet"] for s in snapshot["sources"] if s["sheet"] is not None}:
            part = book.parts[sheet]
            tree = ET.fromstring(archive.read(part.lstrip("/") if part.startswith("/") else "xl/" + part))
            raw_sheets[sheet] = {c.get("r"): c for c in tree.iter(p01.SS + "c")}
        sources = {s["key"]: s for s in snapshot["sources"]}
        for source_row in snapshot["sources"]:
            if source_row["sheet"] is None:
                continue
            sheet, address = source_row["sheet"], source_row["cell"]
            cell = raw_sheets[sheet].get(address)
            raw = None if cell is None else cell.findtext(p01.SS + "v")
            check.require("import_raw", raw == source_row["metadata"]["raw"]["value"], sheet + "!" + address)
            formula_node = None if cell is None else cell.find(p01.SS + "f")
            formula_raw = None if formula_node is None else formula_node.text or ""
            check.require("import_formula", formula_raw == source_row["metadata"]["raw"]["formula"], sheet + "!" + address)
            actual_kind, actual_value = book.cells(sheet).get(address, ("blank", None))
            stored = source_row["metadata"]["excel"]
            if stored["state"] == "number":
                check.require("import_cache", isinstance(actual_value, Decimal) and Decimal(stored["value"]) == actual_value, sheet + "!" + address)
            if stored["state"] in ("error", "missing_cache"):
                anomalies.append({"code": "excel_" + stored["state"], "sheet": sheet, "cell": address, "status": "historical_unexplained", "websiteValue": None})
            check.require("import_missing", source_row["metadata"]["website"]["value"] is None, sheet + "!" + address)
        for row in snapshot["inputs"]:
            source_row = sources[row["sourceKey"]]
            expected = book.num(source_row["sheet"], source_row["cell"])
            multiplier = Decimal(row["conversion"]["multiplier"])
            value = row["value"]
            with localcontext() as context:
                context.prec = 100
                actual = Decimal(value["coefficient"]).scaleb(-value["scale"])
                normalized = (expected * multiplier).quantize(Decimal(1).scaleb(-value["scale"]), rounding=ROUND_HALF_UP)
            check.require("import_normalization", normalized == actual, source_row["sheet"] + "!" + source_row["cell"])
        check.require("import_scope", len(snapshot["products"]) == 4 and len(snapshot["periods"]) == 11, "four products, Year 0 + ten years")
        check.require("import_scope", all(e["websiteValue"] is None for e in candidate["report"]["annual"]), "website values remain unavailable")
    summary = {"status": "passed", "sourceSha256": fingerprint, "candidateFileSha256": hashlib.sha256(candidate_bytes).hexdigest(),
               "controlSha256": control_sha, "checks": dict(check.counts), "anomalies": anomalies,
               "products": list(products), "periods": len(snapshot["periods"]),
               "websiteCalculation": "not_implemented", "pending": candidate["report"]["pending"]}
    return summary, controls


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--controls-output", required=True)
    args = parser.parse_args()
    summary, controls = validate(args.source, args.candidate)
    Path(args.output).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    Path(args.controls_output).write_text(json.dumps(controls, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps({"status": summary["status"], "checks": summary["checks"], "anomalies": len(summary["anomalies"])}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.exit("P05 validation failed: " + str(error))
