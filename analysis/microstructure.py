import os
from dotenv import load_dotenv
from analysis.analysis import hurst_exponent, adf_test, variance_ratio, autocorrelation, half_life

load_dotenv()

MIN_PERIODS          = int(os.getenv("MIN_PERIODS",          30))
CONFLUENCE_THRESHOLD = int(os.getenv("CONFLUENCE_THRESHOLD",  3))

HURST_TREND_THRESHOLD = float(os.getenv("HURST_TREND_THRESHOLD", 0.55))
HURST_MR_THRESHOLD    = float(os.getenv("HURST_MR_THRESHOLD",    0.45))
ADF_PVALUE            = float(os.getenv("ADF_PVALUE",            0.05))
VR_TREND_THRESHOLD    = float(os.getenv("VR_TREND_THRESHOLD",     1.1))
VR_MR_THRESHOLD       = float(os.getenv("VR_MR_THRESHOLD",        0.9))
AC_TREND_THRESHOLD    = float(os.getenv("AC_TREND_THRESHOLD",     0.1))
AC_MR_THRESHOLD       = float(os.getenv("AC_MR_THRESHOLD",       -0.1))
HL_MR_MAX             = float(os.getenv("HL_MR_MAX",              20))

def classify_structure(price_series):
    if len(price_series) < MIN_PERIODS:
        return "inconclusive"

    scores = {"trending": 0, "mean_reverting": 0}

    h = hurst_exponent(price_series)
    if   h > HURST_TREND_THRESHOLD: scores["trending"]       += 1
    elif h < HURST_MR_THRESHOLD:    scores["mean_reverting"] += 1

    p = adf_test(price_series)
    if p < ADF_PVALUE: scores["mean_reverting"] += 1
    else:              scores["trending"]        += 1

    vr = variance_ratio(price_series)
    if   vr > VR_TREND_THRESHOLD: scores["trending"]       += 1
    elif vr < VR_MR_THRESHOLD:    scores["mean_reverting"] += 1

    ac = autocorrelation(price_series)
    if   ac > AC_TREND_THRESHOLD: scores["trending"]       += 1
    elif ac < AC_MR_THRESHOLD:    scores["mean_reverting"] += 1

    try:
        hl = half_life(price_series)
        if   0 < hl < HL_MR_MAX: scores["mean_reverting"] += 1
        elif hl > HL_MR_MAX:     scores["trending"]        += 1
    except Exception:
        pass

    if   scores["trending"]       >= CONFLUENCE_THRESHOLD: return "trending"
    elif scores["mean_reverting"] >= CONFLUENCE_THRESHOLD: return "mean_reverting"
    else:                                                  return "inconclusive"