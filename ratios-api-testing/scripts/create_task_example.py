#!/usr/bin/env python3
"""
Phase 4 prototype: create a task for a client, triggered by an external event
(e.g. a new file uploaded on the filesharing site that needs a follow-up task).

Reference prototype, not production code -- see TESTING_PLAN.md Phase 4.

Usage:
    python scripts/create_task_example.py --client-id <uuid> --title "Review uploaded documents"
"""
import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
from ratios_client import RatiosAPIError, RatiosClient  # noqa: E402

load_dotenv()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client-id", required=True, help="existing client UUID to attach the task to")
    parser.add_argument("--title", required=True)
    parser.add_argument("--deadline", help="YYYY-MM-DD")
    args = parser.parse_args()

    client = RatiosClient(
        base_url=os.environ["RATIOS_BASE_URL"],
        api_key=os.environ["RATIOS_API_KEY"],
        tenant_id=os.environ["RATIOS_TENANT_ID"],
    )
    client.authenticate(os.environ["RATIOS_EMAIL"], os.environ["RATIOS_PASSWORD"])

    payload = {"title": args.title, "client_id": args.client_id}
    if args.deadline:
        payload["deadline"] = args.deadline

    try:
        created = client.create("tasks", payload)
    except RatiosAPIError as e:
        print(f"Failed to create task: {e}", file=sys.stderr)
        sys.exit(1)

    record = created.get("data", created)
    print(f"Created task {record.get('id')}: {record.get('title')}")


if __name__ == "__main__":
    main()
