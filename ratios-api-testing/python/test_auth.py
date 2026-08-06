"""Phase 0 - connectivity & auth smoke tests. Read-only, safe to run anytime."""
import os

import pytest

from ratios_client import RatiosAPIError, RatiosClient


def test_authenticate_returns_access_token(client):
    assert client.access_token, "expected an access_token after authenticate()"


def test_authenticate_with_wrong_password_is_rejected(env_ready):
    bad_client = RatiosClient(
        base_url=os.environ["RATIOS_BASE_URL"],
        api_key=os.environ["RATIOS_API_KEY"],
    )
    with pytest.raises(RatiosAPIError) as exc_info:
        bad_client.authenticate(os.environ["RATIOS_EMAIL"], "definitely-wrong-password")
    assert 400 <= exc_info.value.status_code < 500


def test_list_tenants_includes_configured_tenant(client):
    tenants = client.list_tenants()
    assert isinstance(tenants, list)
    tenant_ids = {t["tenant_id"] for t in tenants}
    assert os.environ["RATIOS_TENANT_ID"] in tenant_ids, (
        "RATIOS_TENANT_ID is not among the tenants this account belongs to"
    )


def test_request_to_foreign_tenant_is_forbidden(client):
    """Confirms tenant isolation. Uses a syntactically valid but unrelated UUID."""
    foreign_tenant = "00000000-0000-0000-0000-000000000000"
    if foreign_tenant == os.environ["RATIOS_TENANT_ID"]:
        pytest.skip("configured tenant_id collides with the probe UUID")
    with pytest.raises(RatiosAPIError) as exc_info:
        client.list("clients", tenant_id=foreign_tenant)
    assert exc_info.value.status_code == 403


def test_request_without_apikey_header_is_rejected(client):
    import requests
    resp = requests.get(
        f"{client.base_url}/functions/v1/api/clients",
        params={"tenant_id": client.tenant_id},
        headers={"Authorization": f"Bearer {client.access_token}"},
        timeout=client.timeout,
    )
    assert resp.status_code in (401, 403)
