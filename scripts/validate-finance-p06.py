"""Independent P06 worksheet reconciliation. Reads original OOXML and application outputs separately."""
import argparse
import hashlib
import importlib.util
import json
import sys
from decimal import Decimal as D
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("p01", ROOT / "docs/validation/project-finance/P01/verify.py")
p01 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p01)


def validate(source, reports):
    blob = Path(source).read_bytes()
    fingerprint = hashlib.sha256(blob).hexdigest()
    assert fingerprint == p01.MATRIX["sample"]["sha256"]
    check = p01.Checks()
    evidence = []

    def close(group, output, expected, location, tolerance="money_in_major_currency"):
        check.require(group, output["status"] in ("ok", "no_funding_required", "recrossed"), location + " / status")
        exact = output["exact"]
        actual = D(exact["numerator"]) / D(exact["denominator"])
        check.close(group, actual, expected, location, tolerance)
        evidence.append({"group": group, "location": location, "status": "passed", "absoluteTolerance": str(p01.TOL[tolerance])})

    with ZipFile(BytesIO(blob)) as archive:
        book = p01.Snapshot(archive)
        p01.verify_scope(book, check)
        control_sha = p01.verify_control_pin(book, check)
        products = {}
        for key, product in p01.MATRIX["products"].items():
            p01.verify_product_inputs(book, check, key, product)
            products[key] = p01.build_product_control(book, check, product)
        controls = p01.verify_project(book, check, products)
        fields = {"revenue":186, "material":187, "labor":188, "scrap":189, "voh":193, "foh":194,
                  "depreciation":195, "factory_profit":204, "allocations":209, "net_engineering":210, "mpbitri":212,
                  "incremental_depreciation":273, "incremental_total_cost":285, "cbt":286,
                  "inventory":320, "receivables":321, "payables":322, "nwc":323, "signed_tax":340, "nwc_change":341,
                  "investment_cash":342, "cash_flow_cny":343, "cash_flow_usd":349, "engineering_budget":426,
                  "engineering_recovery":427, "investment_recovery":430, "net_investment":302}
        for key, product in p01.MATRIX["products"].items():
            sheet = product["sheet"]
            rows = reports["USD"]["products"][key]["periodic"]
            check.require("p06_period_scope", len(rows) == 11, key)
            for i, row in enumerate(rows):
                col = p01.col_name(i + 4)
                for field, excel_row in fields.items():
                    close("p06_product_period", row[field], book.num(sheet, col+str(excel_row), sum_blank=True)*1000, sheet+"!"+col+str(excel_row))
                close("p06_quantity", row["volume"], D(products[key]["pieces"][i]), sheet+"!"+col+"183", "count_or_period")
                for field, excel_row in (("unit_sales",94),("unit_material",99),("unit_labor",102),("unit_voh",107),("unit_foh",108)):
                    close("p06_unit_driver", row[field], book.num(sheet,col+str(excel_row),sum_blank=True),sheet+"!"+col+str(excel_row),"unit_price")
            for currency in ("CNY", "USD"):
                actual = reports[currency]["products"][key]["metrics"]
                for field, tolerance in (("npv","money_in_major_currency"),("irr","ratio_as_fraction"),("payback_period","years"),("peak_funding_requirement","money_in_major_currency")):
                    close("p06_product_returns", actual[field], products[key]["returns"][currency][field], sheet+" / "+currency+" / "+field,tolerance)
                check.require("p06_peak_period", actual["peak_funding_requirement"]["details"]["firstOrdinal"] == products[key]["returns"][currency]["peakPeriod"],key+currency)
                close("p06_product_total",actual["revenue"],sum(products[key]["sales"])*1000 if currency=="CNY" else sum(products[key]["salesUsd"])*1000,sheet+" / revenue "+currency)
                close("p06_product_total",actual["cqa.mpbitri"],sum(products[key]["mpbitri"])*1000 if currency=="CNY" else sum(products[key]["profitUsd"])*1000,sheet+" / MPBITRI "+currency)
        for currency, control in (("CNY",controls["returnsCny"]),("USD",controls["returnsUsd"])):
            report = reports[currency]
            check.require("p06_scope", report["productScope"] == sorted(p01.MATRIX["products"]),currency)
            for i, row in enumerate(report["periodic"]):
                expected = controls["projectCashKcny" if currency=="CNY" else "projectCashKusd"][i]*1000
                close("p06_project_cash",row["cash_flow"],expected,"project "+currency+" / "+str(i))
                cumulative = sum(controls["projectCashKcny" if currency=="CNY" else "projectCashKusd"][:i+1])*1000
                close("p06_project_cumulative",row["cumulative_cash"],cumulative,"project cumulative "+currency+" / "+str(i))
            for field, tolerance in (("npv","money_in_major_currency"),("irr","ratio_as_fraction"),("payback_period","years"),("peak_funding_requirement","money_in_major_currency")):
                close("p06_project_returns",report["metrics"][field],control[field],"project "+currency+" / "+field,tolerance)
            check.require("p06_peak_period",report["metrics"]["peak_funding_requirement"]["details"]["firstOrdinal"]==control["peakPeriod"],"project "+currency)
            check.require("p06_pending_mapping",report["metrics"]["operating_profit"]["status"]=="pending_finance" and report["budget"]["confirmed_actual"]["value"] is None,currency)
    assert hashlib.sha256(Path(source).read_bytes()).hexdigest() == fingerprint
    return {"step":"P06","status":"passed","sourceSha256":fingerprint,"controlSha256":control_sha,"calculationVersion":reports["USD"]["calculationVersion"],
            "products":4,"periodsPerProduct":11,"currencies":["CNY","USD"],"checks":dict(check.counts),"sourceReadOnly":True,"differences":[],"checksByLocation":evidence,
            "privateAmountsExportedToRepository":False,"scope":"P05 upstream schedules at original precision; calculated P&L, cash, aggregation and returns"}


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--source",required=True)
    parser.add_argument("--reports",required=True)
    parser.add_argument("--output",required=True)
    args=parser.parse_args()
    result=validate(args.source,json.loads(Path(args.reports).read_text(encoding="utf-8")))
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"status":result["status"],"checks":result["checks"]}))
