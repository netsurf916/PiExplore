#!/usr/bin/env python3
"""Validate and package the checked-in PARI/GP pi corpus for GitHub Pages."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

KNOWN_PREFIX = b"31415926535897932384626433832795028841971693993751"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--verified-prefix", type=Path, required=True)
    parser.add_argument("--digits", type=int, default=50_000_000)
    parser.add_argument("--chunk-size", type=int, default=1_000_000)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    if args.digits <= 0 or args.chunk_size <= 0:
        raise SystemExit("--digits and --chunk-size must be positive")

    verified_prefix = args.verified_prefix.read_bytes()
    if len(verified_prefix) != 5_000_000:
        raise SystemExit("verified prefix must contain exactly 5,000,000 bytes")
    if not verified_prefix.isdigit() or not verified_prefix.startswith(KNOWN_PREFIX):
        raise SystemExit("verified prefix is not in PiExplore decimal format")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    corpus_digest = hashlib.sha256()
    chunks = []
    total = 0
    prefix_checked = 0

    with gzip.open(args.corpus, "rb") as source:
        while total < args.digits:
            wanted = min(args.chunk_size, args.digits - total)
            content = source.read(wanted)

            if len(content) != wanted:
                raise SystemExit(
                    f"corpus ended early at {total + len(content):,} digits; "
                    f"expected {args.digits:,}"
                )
            if not content.isdigit():
                raise SystemExit(f"non-decimal data found in corpus near index {total:,}")
            if total == 0 and not content.startswith(KNOWN_PREFIX):
                raise SystemExit("50M corpus does not begin with the expected pi prefix")

            if prefix_checked < len(verified_prefix):
                compare_count = min(len(content), len(verified_prefix) - prefix_checked)
                expected = verified_prefix[prefix_checked:prefix_checked + compare_count]
                actual = content[:compare_count]
                if actual != expected:
                    for offset, (left, right) in enumerate(zip(actual, expected)):
                        if left != right:
                            index = prefix_checked + offset
                            raise SystemExit(
                                f"50M corpus disagrees with verified 5M prefix at "
                                f"PiExplore index {index:,}: 50M={chr(left)}, 5M={chr(right)}"
                            )
                    raise SystemExit("50M corpus prefix comparison failed")
                prefix_checked += compare_count

            corpus_digest.update(content)

            filename = f"pi-{total:010d}.txt"
            path = args.output_dir / filename
            path.write_bytes(content)
            chunks.append(
                {
                    "start": total,
                    "count": len(content),
                    "file": filename,
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )
            total += len(content)

        if source.read(1):
            raise SystemExit(
                f"corpus contains more than the expected {args.digits:,} digits"
            )

    if prefix_checked != len(verified_prefix):
        raise SystemExit("failed to compare the complete verified 5M prefix")

    manifest = {
        "formatVersion": 3,
        "index0": "leading 3",
        "totalDigits": total,
        "chunkSize": args.chunk_size,
        "corpusSha256": corpus_digest.hexdigest(),
        "compressedCorpusSha256": sha256_file(args.corpus),
        "source": {
            "file": args.corpus.name,
            "generator": "PARI/GP",
            "verifiedPrefixDigits": len(verified_prefix),
            "verifiedPrefixFile": args.verified_prefix.name,
            "verification": (
                "gzip integrity + decimal format + exact 50M length + "
                "full byte-for-byte match of first 5M digits against independently "
                "verified PARI/GP == mpmath corpus"
            ),
        },
        "chunks": chunks,
    }

    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    print(
        f"Validated and packaged {total:,} local digits in {len(chunks)} chunks."
    )
    print(f"50M corpus SHA-256: {manifest['corpusSha256']}")
    print(f"Compressed source SHA-256: {manifest['compressedCorpusSha256']}")


if __name__ == "__main__":
    main()
