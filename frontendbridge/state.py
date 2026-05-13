import threading, time
from datetime import datetime, timezone

lock  = threading.Lock()

state = {
    "ticks":      {},
    "signal_log": [],
    "positions":  [],
    "account":    {},
    # daily accumulators — reset at midnight UTC
    "taken":      0,
    "skipped":    0,
    "wins":       0,
    "losses":     0,
    "closed_pnl": 0.0,
    "total_pnl":  0.0,
    "max_concurrent": 5,
    "uptime_start": time.time(),
}

def _midnight_reset():
    """Resets daily metrics at UTC midnight every day."""
    while True:
        now = datetime.now(timezone.utc)
        # seconds until next midnight
        secs_to_midnight = 86400 - (now.hour * 3600 + now.minute * 60 + now.second)
        time.sleep(secs_to_midnight)
        with lock:
            state["taken"]      = 0
            state["skipped"]    = 0
            state["wins"]       = 0
            state["losses"]     = 0
            state["closed_pnl"] = 0.0
            state["total_pnl"]  = 0.0
            state["signal_log"] = []
            state["positions"]  = []
        print("[STATE] Midnight reset complete.")

import threading as _t
_t.Thread(target=_midnight_reset, daemon=True).start()
