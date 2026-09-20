#!/usr/bin/env python3
"""Verify and package a static corpus containing the leading digits of pi."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import mpmath as mp

KNOWN_PREFIX = "31415926535897932384626433832795028841971693993751"
MPMATH_VERSION = "1.3.0"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def first_mismatch(a: bytes, b: bytes) -> int | None:
    for i, (left, right) in enumerate(zip(a, b)):
        if left != right:
            return i
    if len(a) != len(b):
        return min(len(a), len(b))
    return None


def generate_mpmath_digits(count: int) -> bytes:
    # Guard digits ensure that truncating the rendered value cannot be affected
    # by rounding at the requested boundary.
    mp.mp.dps = count + 30
    rendered = str(mp.pi)
    whole, fractional = rendered.split(".", 1)
    digits = (whole + fractional)[:count]

    if len(digits) != count or not digits.isdigit():
        raise SystemExit("mpmath generated pi data has an unexpected format")
    if not digits.startswith(KNOWN_PREFIX):
        raise SystemExit("mpmath pi prefix verification failed")

    return digits.encode("ascii")


def load_reference(path: Path, count: int) -> bytes:
    reference = path.read_bytes()

    if len(reference) != count:
        raise SystemExit(
            f"reference file must contain exactly {count:,} bytes; "
            f"found {len(reference):,}"
        )
    if not reference.isdigit():
        raise SystemExit("reference file must contain ASCII decimal digits only")
    if not reference.startswith(KNOWN_PREFIX.encode("ascii")):
        raise SystemExit("reference pi prefix verification failed")

    return reference


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--digits", type=int, default=5_000_000)
    parser.add_argument("--chunk-size", type=int, default=1_000_000)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    if args.digits <= 0:
        raise SystemExit("--digits must be positive")
    if args.chunk_size <= 0:
        raise SystemExit("--chunk-size must be positive")

    reference = load_reference(args.reference, args.digits)
    generated = generate_mpmath_digits(args.digits)

    mismatch = first_mismatch(reference, generated)
    if mismatch is not None:
        ref_digit = chr(reference[mismatch]) if mismatch < len(reference) else "<EOF>"
        mp_digit = chr(generated[mismatch]) if mismatch < len(generated) else "<EOF>"
        raise SystemExit(
            "PARI/GP reference and mpmath disagree: "
            f"first mismatch at PiExplore index {mismatch:,} "
            f"(PARI={ref_digit}, mpmath={mp_digit})"
        )

    corpus_sha256 = sha256_bytes(reference)
    print(
        f"Verified {args.digits:,} digits byte-for-byte: "
        f"PARI/GP reference == mpmath {MPMATH_VERSION}"
    )
    print(f"Verified corpus SHA-256: {corpus_sha256}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    chunks = []

    for start in range(0, args.digits, args.chunk_size):
        content = reference[start:start + args.chunk_size]
        filename = f"pi-{start:010d}.txt"
        (args.output_dir / filename).write_bytes(content)
        chunks.append(
            {
                "start": start,
                "count": len(content),
                "file": filename,
                "sha256": sha256_bytes(content),
            }
        )

    manifest = {
        "formatVersion": 2,
        "index0": "leading 3",
        "totalDigits": len(reference),
        "chunkSize": args.chunk_size,
        "corpusSha256": corpus_sha256,
        "sources": {
            "reference": args.reference.name,
            "referenceGenerator": "PARI/GP",
            "independentVerifier": f"mpmath {MPMATH_VERSION}",
            "verification": "full byte-for-byte comparison",
        },
        "chunks": chunks,
    }

    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    print(
        f"Packaged {len(reference):,} verified digits in {len(chunks)} chunks; "
        f"manifest: {args.output_dir / 'manifest.json'}"
    )


if __name__ == "__main__":
    main()
