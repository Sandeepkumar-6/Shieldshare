# ShieldShare auxiliary ML service

This FastAPI service scores one user-activity window with an Isolation Forest trained on simulated normal activity. It reports whether a window is anomalous relative to that synthetic baseline; it does **not** identify ransomware and it is never required for deterministic containment.

## Setup and run

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe generate_synthetic.py
.venv\Scripts\python.exe train.py
.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Run tests with `.venv\Scripts\python.exe -m pytest`.

The generated `eval_report.md` is a pipeline sanity check using synthetic normal and synthetic attack-like windows. It is not a real-world accuracy measurement.
