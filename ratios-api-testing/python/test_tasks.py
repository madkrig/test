"""Phase 2 - CRUD correctness for the `tasks` resource, including required lookups
(task_statuses/task_types) needed to build a valid task payload."""
import pytest

from ratios_client import RatiosAPIError


@pytest.fixture
def test_client_record(client, test_prefix, cleanup):
    """A throwaway client record to attach test tasks to."""
    created = client.create("clients", {
        "company_name": f"{test_prefix}Task Test Client ApS",
        "email": "qa-task-test-client@example.com",
    })
    record = created.get("data", created)
    cleanup("clients", record["id"])
    return record


def test_list_task_statuses_not_empty(client):
    body = client.list("task_statuses", per_page=50)
    assert isinstance(body["data"], list)


@pytest.mark.writes
def test_create_update_delete_task(client, test_prefix, cleanup, test_client_record):
    created = client.create("tasks", {
        "title": f"{test_prefix}Test Task",
        "client_id": test_client_record["id"],
        "deadline": "2026-09-01",
    })
    record = created.get("data", created)
    task_id = record["id"]
    cleanup("tasks", task_id)

    updated = client.update("tasks", task_id, {"title": f"{test_prefix}Test Task (updated)"})
    updated_record = updated.get("data", updated)
    assert updated_record.get("title") == f"{test_prefix}Test Task (updated)"

    client.delete("tasks", task_id)


def test_filter_tasks_by_client_id(client, test_client_record):
    body = client.list("tasks", **{"filter.client_id": f"eq.{test_client_record['id']}"})
    for record in body["data"]:
        assert record.get("client_id") == test_client_record["id"]


@pytest.mark.writes
def test_create_task_with_invalid_client_id_is_rejected(client, test_prefix):
    with pytest.raises(RatiosAPIError) as exc_info:
        client.create("tasks", {
            "title": f"{test_prefix}Orphan Task",
            "client_id": "00000000-0000-0000-0000-000000000000",
        })
    assert 400 <= exc_info.value.status_code < 500
