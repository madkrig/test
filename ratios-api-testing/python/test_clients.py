"""Phase 2 - CRUD correctness for the `clients` resource.
Write tests are marked `writes` and clean up via the `cleanup` fixture."""
import pytest

from ratios_client import RatiosAPIError


def test_list_clients_returns_expected_shape(client):
    body = client.list("clients", per_page=5)
    assert "data" in body and isinstance(body["data"], list)
    assert "pagination" in body, "expected a pagination object alongside data"


@pytest.mark.writes
def test_create_read_update_delete_client(client, test_prefix, cleanup):
    created = client.create("clients", {
        "company_name": f"{test_prefix}Test Company ApS",
        "email": "qa-test-client@example.com",
        "city": "København",
    })
    record = created.get("data", created)
    client_id = record["id"]
    cleanup("clients", client_id)

    fetched = client.get("clients", client_id)
    fetched_record = fetched.get("data", fetched)
    assert fetched_record["company_name"] == f"{test_prefix}Test Company ApS"

    updated = client.update("clients", client_id, {"city": "Aarhus"})
    updated_record = updated.get("data", updated)
    assert updated_record.get("city") == "Aarhus"

    client.delete("clients", client_id)
    # Document actual soft-delete visibility behavior (open question in TESTING_PLAN.md):
    # this assertion may need updating once real behavior is confirmed against the sandbox.
    with pytest.raises(RatiosAPIError):
        client.get("clients", client_id)


@pytest.mark.writes
def test_create_client_missing_required_field_returns_client_error(client):
    with pytest.raises(RatiosAPIError) as exc_info:
        client.create("clients", {})  # no company_name -- expect 4xx, capture error shape
    assert 400 <= exc_info.value.status_code < 500


def test_filter_clients_by_city(client):
    body = client.list("clients", **{"filter.city": "eq.København"}, per_page=5)
    for record in body["data"]:
        assert record.get("city") == "København"


def test_select_limits_returned_fields(client):
    body = client.list("clients", select="id,company_name", per_page=5)
    for record in body["data"]:
        assert set(record.keys()) <= {"id", "company_name"}
