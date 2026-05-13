import json, os
import numpy as np
import MetaTrader5 as mt5
from dotenv import load_dotenv

load_dotenv()

LOOKBACK   = int(os.getenv("MR_LOOKBACK",    20))
Z_ENTRY    = float(os.getenv("MR_Z_ENTRY",  1.5))
SL_POINTS  = int(os.getenv("MR_SL_POINTS", 100))
TP_POINTS  = int(os.getenv("MR_TP_POINTS", 200))
LOG_PREFIX = os.getenv("MR_LOG_PREFIX",    "MR")

def compute_zscore(price_series):
    if len(price_series) < LOOKBACK:
        return None
    window = np.array(price_series[-LOOKBACK:])
    std    = np.std(window)
    return None if std == 0 else (window[-1] - np.mean(window)) / std

def run_node(data, symbol, price, structure, socket):
    if structure != "mean_reverting":
        return

    price_series = [d["Bid"] for d in data if d["Ticker"] == symbol]
    z = compute_zscore(price_series)
    if z is None:
        return

    if z <= -Z_ENTRY:
        direction = "buy"
    elif z >= Z_ENTRY:
        direction = "sell"
    else:
        return

    symbol_info = mt5.symbol_info(symbol)
    if symbol_info is None:
        print(f"[{LOG_PREFIX}] No symbol info for {symbol}, skipping")
        return

    point = symbol_info.point
    buy   = direction == "buy"

    sl = price - point * SL_POINTS if buy else price + point * SL_POINTS
    tp = price + point * TP_POINTS if buy else price - point * TP_POINTS

    socket.send_string(json.dumps({
        "symbol":    symbol,
        "direction": direction,
        "price":     price,
        "sl":        sl,
        "tp":        tp
    }))
    print(f"[{LOG_PREFIX}] {symbol} | {direction} | z={z:.3f}")