import os
from dotenv import load_dotenv
from analysis.hmm_model import fit, predict

load_dotenv()

WARMUP         = int(os.getenv("WARMUP",         100))
REFIT_INTERVAL = int(os.getenv("REFIT_INTERVAL",  50))
FIT_WINDOW     = int(os.getenv("FIT_WINDOW",      100))
LOG_PREFIX     = os.getenv("REGIME_LOG_PREFIX", "REGIME")

_state = {"model": None, "ticks_since_refit": 0}

def classify(data, n_states):
    if len(data) < WARMUP:
        print(f"[{LOG_PREFIX}] Warming up... {len(data)}/{WARMUP}")
        return None

    _state["ticks_since_refit"] += 1

    if _state["model"] is None or _state["ticks_since_refit"] >= REFIT_INTERVAL:
        _state["model"] = fit(data[-FIT_WINDOW:], n_states)
        _state["ticks_since_refit"] = 0
        print(f"[{LOG_PREFIX}] Model refit on latest {FIT_WINDOW} candles")

    return predict(_state["model"], data[-FIT_WINDOW:])[-1]