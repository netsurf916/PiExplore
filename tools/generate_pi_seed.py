#!/usr/bin/env python3
"""Generate deterministic static chunks containing the leading digits of pi."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import mpmath as mp

KNOWN_PREFIX = "31415926535897932384626433832795028841971693993751"
# Public reference checkpoint: the last 100 digits among the first 1,000,000
# fractional decimal digits. In PiExplore indexing these occupy 999901..1000000.
KNOWN_1M_FRACTIONAL_TAIL = (
    "0315614033321272849194418437150696552087542450598956787961303311"
    "646283996346460422090106105779458151"
)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--digits", type=int, default=5_000_000)
    parser.add_argument("--chunk-size", type=int, default=1_000_000)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    if args.digits < 1_000_001:
        raise SystemExit("--digits must be at least 1,000,001 for verification")
    if args.chunk_size <= 0:
        raise SystemExit("--chunk-size must be positive")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Guard digits protect the final requested decimal places from rounding.
    mp.mp.dps = args.digits + 30
    rendered = str(mp.pi)
    whole, fractional = rendered.split(".", 1)
    digits = (whole + fractional)[: args.digits]

    if len(digits) != args.digits or not digits.isdigit():
        raise SystemExit("generated pi data has an unexpected format")
    if not digits.startswith(KNOWN_PREFIX):
        raise SystemExit("pi prefix verification failed")
    if digits[999_901:1_000_001] != KNOWN_1M_FRACTIONAL_TAIL:
        raise SystemExit("1,000,000-fractional-digit checkpoint verification failed")

    chunks = []
    for start in range(0, args.digits, args.chunk_size):
        content = digits[start:start + args.chunk_size]
        filename = f"pi-{start:010d}.txt"
        (args.output_dir / filename).write_text(content, encoding="ascii")
        chunks.append(
            {
                "start": start,
                "count": len(content),
                "file": filename,
                "sha256": sha256_text(content),
            }
        )

    manifest = {
        "formatVersion": 1,
        "index0": "leading 3",
        "totalDigits": len(digits),
        "chunkSize": args.chunk_size,
        "generator": "mpmath 1.3.0",
        "verification": {
            "prefix": KNOWN_PREFIX,
            "oneMillionFractionalTail": KNOWN_1M_FRACTIONAL_TAIL,
        },
        "chunks": chunks,
    }
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    print(
        f"Generated {len(digits):,} digits in {len(chunks)} chunks; "
        f"manifest: {args.output_dir / 'manifest.json'}"
    )


if __name__ == "__main__":
    main()
