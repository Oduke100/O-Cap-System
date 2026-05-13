# O-Cap Model

A toy I built over some weekends to watch markets and do things automatically.

It connects to MetaTrader 5, runs some math, and decides what to do. There's a dashboard so I can watch it do its thing in real time.

## Stack

- Python — data, signals, risk, execution
- React + Vite — terminal dashboard
- ZeroMQ — internal message passing
- MetaTrader 5 — broker connection
- WebSockets — bridge between the backend and the UI

## Structure
model/
├── data/           # market data streaming
├── analysis/       # the math
├── risk/           # sizing and gating
├── execution/      # order sending
├── frontendbridge/ # websocket server
└── dashboard/      # react terminal

## Running

Start the backend:
```powershell
python -m frontendbridge.server
```

Start the data stream:
```powershell
python main.py
```

Start the dashboard:
```powershell
cd dashboard
npm run dev
```

## Config

Everything lives in `.env`. Ports, symbols, credentials, strategy params. Don't commit it.

---

*It's just a toy.*
