"""Phase 2 - `profiles` / `profiles/create-user` (the "user sync" endpoint).
Requires the test account to have admin or owner role -- confirm before running."""
import pytest

from ratios_client import RatiosAPIError


def test_list_profiles_hides_sensitive_fields(client):
    body = client.list("profiles", per_page=10)
    for record in body["data"]:
        assert "ssn" not in {k.lower() for k in record.keys()}, (
            "SSN-like field unexpectedly present in profiles response"
        )


@pytest.mark.writes
def test_create_user_with_profile(client, test_prefix, cleanup):
    """send_welcome_email is deliberately False so automated runs never email a real inbox."""
    created = client.create_user({
        "email": f"qa-test-{test_prefix.lower()}@example.com",
        "first_name": test_prefix,
        "last_name": "Test",
        "role": "member",
        "send_welcome_email": False,
    })
    record = created.get("data", created)
    assert record.get("email", "").startswith("qa-test-")
    if "id" in record:
        cleanup("profiles", record["id"])


@pytest.mark.writes
def test_create_user_missing_email_is_rejected(client, test_prefix):
    with pytest.raises(RatiosAPIError) as exc_info:
        client.create_user({
            "first_name": test_prefix,
            "last_name": "Test",
            "role": "member",
        })
    assert 400 <= exc_info.value.status_code < 500
