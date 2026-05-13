import json, os
import numpy as np
import MetaTrader5 as mt5
from dotenv import load_dotenv

load_dotenv()

SMA_FAST   = int(os.getenv("SMA_FAST",       9))
SMA_SLOW   = int(os.getenv("SMA_SLOW",      14))
SL_POINTS  = int(os.getenv("SMA_SL_POINTS", 100))
TP_POINTS  = int(os.getenv("SMA_TP_POINTS", 200))
LOG_PREFIX = os.getenv("SMA_LOG_PREFIX",   "SMA")

def check_crossover(price_series):
    if len(price_series) < SMA_SLOW + 1:
        return None

    fast_now  = np.mean(price_series[-SMA_FAST:])
    slow_now  = np.mean(price_series[-SMA_SLOW:])
    fast_prev = np.mean(price_series[-SMA_FAST - 1:-1])
    slow_prev = np.mean(price_series[-SMA_SLOW - 1:-1])

    if fast_prev <= slow_prev and fast_now > slow_now:
        return "buy"
    if fast_prev >= slow_prev and fast_now < slow_now:
        return "sell"
    return None

def run_node(data, symbol, price, structure, socket):
    if structure != "trending":
        return

    price_series = [d["Bid"] for d in data if d["Ticker"] == symbol]
    direction    = check_crossover(price_series)
    if direction is None:
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
    print(f"[{LOG_PREFIX}] {symbol} | {direction}")