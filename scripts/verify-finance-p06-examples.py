"""Independent standard-library Decimal/closed-form reference for plan T1 and T2."""
import argparse
import json
from decimal import Decimal as D, getcontext
from pathlib import Path

getcontext().prec = 60


def reference():
    unit_before = D(2) * 30 * 60 / 3600
    unit_after = D(2) * 36 * 60 / 3600
    extra = (unit_after - unit_before) * 10000
    return {"T1": {"npv": -D(100) + D(60)/D("1.1") + D(60)/D("1.1")**2,
                   "irr": (D(60) + D(27600).sqrt())/200 - 1,
                   "payback_period": D(1) + D(40)/60, "peak_funding_requirement": D(100)},
            "T2": {"unit_labor_before": unit_before, "unit_labor_after": unit_after,
                   "annual_labor_change": extra, "operating_profit_change": -extra,
                   "cash_flow_change": -extra, "npv_change": -extra/D("1.1")}}


def validate(actual):
    expected = reference()
    checks = []
    for case, values in expected.items():
        for key, value in values.items():
            tolerance = D("0.00000001") if key == "irr" else D("0.000001") if key in ("payback_period", "unit_labor_before", "unit_labor_after") else D("0.01")
            calculated = D(actual[case][key]["value"] if case == "T1" else actual[case][key])
            assert abs(calculated - value) <= tolerance, (case, key)
            checks.append({"case": case, "field": key, "status": "passed", "absoluteTolerance": str(tolerance)})
    assert actual["T1"]["peakOrdinal"] == 0
    assert [actual["T1"][k]["display"] for k in expected["T1"]] == ["4.13", "13.07", "1.67", "100.00"]
    assert actual["T2"]["npv_change_display"] == "-1818.18"
    return {"status": "passed", "reference": "Python Decimal, T1 quadratic closed form and T2 person-hours; no application imports", "checks": checks,
            "expected": {c: {k: str(v) for k, v in values.items()} for c, values in expected.items()}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--results")
    parser.add_argument("--output")
    args = parser.parse_args()
    result = validate(json.loads(Path(args.results).read_text(encoding="utf-8"))) if args.results else {c: {k: str(v) for k, v in v.items()} for c, v in reference().items()}
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(encoded, encoding="utf-8")
    else:
        print(encoded)
