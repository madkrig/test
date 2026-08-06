import os
import uuid

import pytest
from dotenv import load_dotenv

from ratios_client import RatiosClient

load_dotenv()

REQUIRED_VARS = ["RATIOS_BASE_URL", "RATIOS_API_KEY", "RATIOS_EMAIL", "RATIOS_PASSWORD", "RATIOS_TENANT_ID"]


def _missing_vars() -> list[str]:
    return [v for v in REQUIRED_VARS if not os.environ.get(v)]


@pytest.fixture(scope="session")
def env_ready():
    missing = _missing_vars()
    if missing:
        pytest.skip(f"Missing required env vars for live API tests: {', '.join(missing)}. "
                     f"Copy .env.example to .env and fill it in.")


@pytest.fixture(scope="session")
def client(env_ready) -> RatiosClient:
    c = RatiosClient(
        base_url=os.environ["RATIOS_BASE_URL"],
        api_key=os.environ["RATIOS_API_KEY"],
        tenant_id=os.environ["RATIOS_TENANT_ID"],
    )
    c.authenticate(os.environ["RATIOS_EMAIL"], os.environ["RATIOS_PASSWORD"])
    return c


@pytest.fixture
def test_prefix() -> str:
    base = os.environ.get("RATIOS_TEST_PREFIX", "ZZ_QA_")
    return f"{base}{uuid.uuid4().hex[:8]}_"


@pytest.fixture
def cleanup(client):
    """Collects (resource, id) pairs created during a test and soft-deletes them
    afterwards, even if the test fails partway through."""
    created: list[tuple[str, str]] = []

    def _track(resource: str, record_id: str):
        created.append((resource, record_id))
        return record_id

    yield _track

    for resource, record_id in reversed(created):
        try:
            client.delete(resource, record_id)
        except Exception as exc:  # best-effort cleanup, don't fail the test run on cleanup errors
            print(f"cleanup warning: failed to delete {resource}/{record_id}: {exc}")
