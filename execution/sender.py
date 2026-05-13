import os
import MetaTrader5 as mt5
from dotenv import load_dotenv

load_dotenv()

LOGIN      = int(os.getenv("login"))
PASSWORD   = os.getenv("password")
SERVER     = os.getenv("server")
DEVIATION  = int(os.getenv("DEVIATION",           10))
MAGIC      = int(os.getenv("MAGIC",                0))
COMMENT    = os.getenv("ORDER_COMMENT",        "ocap")
LOG_PREFIX = os.getenv("EXECUTOR_LOG_PREFIX", "EXECUTOR")
FILLING_MODE_MAP = {
    "FOK":    mt5.ORDER_FILLING_FOK,
    "IOC":    mt5.ORDER_FILLING_IOC,
    "RETURN": mt5.ORDER_FILLING_RETURN,
}
FILLING_MODE = FILLING_MODE_MAP.get(os.getenv("FILLING_MODE", "FOK"), mt5.ORDER_FILLING_FOK)

if not mt5.initialize(login=LOGIN, password=PASSWORD, server=SERVER):
    print(f"[{LOG_PREFIX}] MT5 init failed:", mt5.last_error())
    quit()
print(f"[{LOG_PREFIX}] MT5 connected")

def send_order(symbol, direction, volume, price, sl, tp):
    result = mt5.order_send({
        "action":       mt5.TRADE_ACTION_DEAL,
        "symbol":       symbol,
        "volume":       float(volume),
        "type":         mt5.ORDER_TYPE_BUY if direction == "buy" else mt5.ORDER_TYPE_SELL,
        "price":        float(price),
        "sl":           float(sl),
        "tp":           float(tp),
        "deviation":    DEVIATION,
        "magic":        MAGIC,
        "comment":      COMMENT,
        "type_filling": FILLING_MODE,
    })

    if result is None:
        print(f"[{LOG_PREFIX}] Order failed | {symbol} | mt5 returned None | error: {mt5.last_error()}")
        return None
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        print(f"[{LOG_PREFIX}] Order failed | {symbol} | retcode: {result.retcode} | comment: {result.comment}")
        return None

    print(f"[{LOG_PREFIX}] Order sent | {symbol} | {direction.upper()} | vol={volume} | price={price:.4f} | sl={sl:.4f} | tp={tp:.4f}")
    return result