#!/usr/bin/env python3
"""
Phase 4 prototype: full + incremental client sync.

This is a reference prototype for the "client sync" use case, not production code --
it demonstrates the pagination and incremental-filter pattern from TESTING_PLAN.md
(Phase 4) using the shared RatiosClient. Confirm the `updated_at` field name against
a real `clients` record (Phase 1) before relying on the incremental path.

Usage:
    python scripts/sync_clients_example.py --since 2026-01-01
    python scripts/sync_clients_example.py          # full sync
"""
import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
from ratios_client import RatiosClient  # noqa: E402

load_dotenv()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", help="ISO date; only pull clients updated_at >= this value")
    args = parser.parse_args()

    client = RatiosClient(
        base_url=os.environ["RATIOS_BASE_URL"],
        api_key=os.environ["RATIOS_API_KEY"],
        tenant_id=os.environ["RATIOS_TENANT_ID"],
    )
    client.authenticate(os.environ["RATIOS_EMAIL"], os.environ["RATIOS_PASSWORD"])

    params = {}
    if args.since:
        params["filter.updated_at"] = f"gte.{args.since}"

    count = 0
    for record in client.paginate("clients", **params):
        count += 1
        print(f"{record.get('id')}\t{record.get('company_name')}\t{record.get('updated_at')}")

    print(f"\nSynced {count} client record(s).", file=sys.stderr)


if __name__ == "__main__":
    main()
