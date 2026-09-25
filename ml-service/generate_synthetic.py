from pathlib import Path

import numpy as np
import pandas as pd

from feature_contract import FEATURES

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RNG = np.random.default_rng(20260925)


def normal_rows(count: int) -> pd.DataFrame:
    ops = RNG.gamma(2.0, 2.2, count).clip(0.1, 20)
    mods = np.minimum(ops, RNG.gamma(1.4, 1.2, count))
    renames = np.minimum(ops - np.minimum(ops, mods), RNG.poisson(0.35, count))
    deletes = np.minimum(np.maximum(0, ops - mods - renames), RNG.poisson(0.08, count))
    return pd.DataFrame({
        "ops_per_min": ops,
        "mods_per_min": mods,
        "renames_per_min": renames,
        "deletes_per_min": deletes,
        "dirs_affected": RNG.integers(1, 4, count),
        "ext_changes": RNG.binomial(2, 0.06, count),
        "entropy_delta_mean": RNG.gamma(0.5, 0.16, count).clip(0, 0.8),
        "entropy_delta_max": RNG.gamma(0.7, 0.22, count).clip(0, 1.2),
        "hash_change_ratio": RNG.beta(1.5, 5.0, count),
        "mean_interarrival_ms": RNG.lognormal(np.log(12_000), 0.7, count).clip(900, 120_000),
    })[FEATURES]


def attack_like_rows(count: int) -> pd.DataFrame:
    return pd.DataFrame({
        "ops_per_min": RNG.uniform(35, 130, count),
        "mods_per_min": RNG.uniform(15, 75, count),
        "renames_per_min": RNG.uniform(8, 55, count),
        "deletes_per_min": RNG.uniform(0, 20, count),
        "dirs_affected": RNG.integers(3, 12, count),
        "ext_changes": RNG.integers(4, 40, count),
        "entropy_delta_mean": RNG.uniform(1.3, 3.8, count),
        "entropy_delta_max": RNG.uniform(2.0, 4.5, count),
        "hash_change_ratio": RNG.uniform(0.65, 1.0, count),
        "mean_interarrival_ms": RNG.uniform(60, 900, count),
    })[FEATURES]


def write(frame: pd.DataFrame, path: Path, label: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(f"# SYNTHETIC DATA — {label}\n")
        frame.to_csv(handle, index=False)


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    write(normal_rows(5000), DATA / "synthetic_normal.csv", "simulated normal activity")
    write(attack_like_rows(400), DATA / "synthetic_attack_like.csv", "simulated attack-like activity for pipeline sanity checks only")
    print(f"Wrote synthetic datasets to {DATA}")
