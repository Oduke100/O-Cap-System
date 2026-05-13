import os
import MetaTrader5 as mt5
from dotenv import load_dotenv

load_dotenv()

DEFAULT_LOT  = float(os.getenv("DEFAULT_LOT",  0.1))
RISK_PERCENT = float(os.getenv("RISK_PERCENT",  1.0))
LOG_PREFIX   = os.getenv("FALLBACK_LOG_PREFIX", "RISK")

def get_account_balance():
    info = mt5.account_info()
    if info is None:
        print(f"[{LOG_PREFIX}] Failed to get account info")
        return None
    return info.balance

def calculate_lot_size(symbol, sl_points):
    balance = get_account_balance()
    if balance is None:
        print(f"[{LOG_PREFIX}] Falling back to default lot: {DEFAULT_LOT}")
        return DEFAULT_LOT

    risk_amount = balance * (RISK_PERCENT / 100)
    symbol_info = mt5.symbol_info(symbol)

    if symbol_info is None:
        print(f"[{LOG_PREFIX}] Symbol info unavailable for {symbol}, falling back to default lot")
        return DEFAULT_LOT

    tick_value = symbol_info.trade_tick_value
    tick_size  = symbol_info.trade_tick_size

    if tick_size == 0 or sl_points == 0:
        print(f"[{LOG_PREFIX}] Invalid tick size or SL points, falling back to default lot")
        return DEFAULT_LOT

    lot = risk_amount / (sl_points / tick_size * tick_value)
    lot = round(lot, 2)
    lot = max(symbol_info.volume_min, min(lot, symbol_info.volume_max))

    return lot

def size_order(signal):
    symbol = signal["symbol"]
    price  = signal["price"]
    sl     = signal["sl"]

    lot = calculate_lot_size(symbol, abs(price - sl))

    return {
        "symbol":    symbol,
        "direction": signal["direction"],
        "volume":    lot,
        "price":     price,
        "sl":        sl,
        "tp":        signal["tp"]
    }