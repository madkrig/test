"""Phase 3 - pagination, filtering, ordering, field selection edge cases."""
import pytest

from ratios_client import RatiosAPIError


def test_default_per_page(client):
    body = client.list("clients")
    assert len(body["data"]) <= 50


def test_per_page_max_200_is_accepted(client):
    body = client.list("clients", per_page=200)
    assert len(body["data"]) <= 200


def test_per_page_above_max_is_clamped_or_rejected(client):
    """Docs say max per_page is 200 but don't say what happens above it -- confirm empirically."""
    try:
        body = client.list("clients", per_page=201)
        assert len(body["data"]) <= 200, "expected per_page to be clamped to 200"
    except RatiosAPIError as e:
        assert 400 <= e.status_code < 500


def test_page_beyond_last_returns_empty_not_error(client):
    body = client.list("clients", page=999999, per_page=50)
    assert body["data"] == []


def test_order_by_company_name_asc(client):
    body = client.list("clients", order_by="company_name", order_dir="asc", per_page=20)
    names = [r.get("company_name") for r in body["data"] if r.get("company_name") is not None]
    assert names == sorted(names)


@pytest.mark.parametrize("op,value", [
    ("eq", "København"),
    ("neq", "København"),
    ("ilike", "%aps"),
])
def test_string_filter_operators(client, op, value):
    body = client.list("clients", **{"filter.city": f"{op}.{value}"}, per_page=5)
    assert isinstance(body["data"], list)


def test_is_null_filter(client):
    body = client.list("clients", **{"filter.email": "is.null"}, per_page=5)
    for record in body["data"]:
        assert record.get("email") in (None, "")


def test_in_filter(client):
    body = client.list("invoices", **{"filter.status": "in.draft,sent"}, per_page=5)
    for record in body["data"]:
        assert record.get("status") in ("draft", "sent")
