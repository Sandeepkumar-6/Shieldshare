# Synthetic pipeline sanity check

This is a pipeline sanity check on generated data, **not** a measurement of real-world ransomware accuracy.

- Training data: 4000 simulated normal windows
- Held-out synthetic normal windows flagged: 2.4%
- Synthetic attack-like windows flagged: 100.0%
- Model: `if-2026-09-25-synthetic`

The supported claim is: the Isolation Forest was trained on simulated normal activity and flags activity that is anomalous relative to that baseline.
