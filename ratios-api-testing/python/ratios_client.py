"""
Minimal Ratios API client used both by the pytest suite and as a reference
implementation for production sync scripts (see TESTING_PLAN.md, section 5).

Deliberately thin: it encodes the auth handshake, the tenant_id-on-every-request
rule, and pagination -- not resource-specific business logic.
"""
from __future__ import annotations

import time
from typing import Any, Iterator

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class RatiosAPIError(RuntimeError):
    def __init__(self, response: requests.Response):
        self.status_code = response.status_code
        try:
            self.body = response.json()
        except ValueError:
            self.body = response.text
        super().__init__(f"Ratios API error {self.status_code}: {self.body}")


class RatiosClient:
    def __init__(self, base_url: str, api_key: str, tenant_id: str | None = None,
                 timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.tenant_id = tenant_id
        self.timeout = timeout
        self.access_token: str | None = None
        self.refresh_token: str | None = None
        self._email: str | None = None
        self._password: str | None = None

        self.session = requests.Session()
        # Retry only on connection-level failures / 5xx -- never retry POST on a
        # timeout, since resource creation is not confirmed idempotent (see
        # TESTING_PLAN.md Phase 5). GET/PATCH/DELETE are safe to retry.
        retry = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=(502, 503, 504),
            allowed_methods=("GET", "PATCH", "DELETE", "PUT"),
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retry))

    # -- auth -----------------------------------------------------------

    def authenticate(self, email: str, password: str) -> dict:
        self._email, self._password = email, password
        resp = self.session.post(
            f"{self.base_url}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": self.api_key, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=self.timeout,
        )
        if resp.status_code >= 400:
            raise RatiosAPIError(resp)
        data = resp.json()
        self.access_token = data.get("access_token")
        self.refresh_token = data.get("refresh_token")
        return data

    def list_tenants(self) -> list[dict]:
        return self._request("GET", "/functions/v1/api/tenants", tenant_scoped=False)["data"]

    # -- generic CRUD -----------------------------------------------------

    def list(self, resource: str, **params: Any) -> dict:
        """Single page. Returns the raw {"data": [...], "pagination": {...}} body."""
        return self._request("GET", f"/functions/v1/api/{resource}", params=params)

    def paginate(self, resource: str, per_page: int = 200, **params: Any) -> Iterator[dict]:
        """Yields every record across all pages, largest page size by default."""
        page = 1
        while True:
            body = self.list(resource, page=page, per_page=per_page, **params)
            records = body.get("data", [])
            if not records:
                return
            yield from records
            page += 1

    def get(self, resource: str, record_id: str, **params: Any) -> dict:
        return self._request("GET", f"/functions/v1/api/{resource}/{record_id}", params=params)

    def create(self, resource: str, payload: dict, **params: Any) -> dict:
        return self._request("POST", f"/functions/v1/api/{resource}", params=params, json=payload)

    def update(self, resource: str, record_id: str, payload: dict, **params: Any) -> dict:
        return self._request(
            "PATCH", f"/functions/v1/api/{resource}/{record_id}", params=params, json=payload
        )

    def delete(self, resource: str, record_id: str, **params: Any) -> dict:
        return self._request("DELETE", f"/functions/v1/api/{resource}/{record_id}", params=params)

    # -- special endpoints -------------------------------------------------

    def create_user(self, payload: dict, **params: Any) -> dict:
        return self._request(
            "POST", "/functions/v1/api/profiles/create-user", params=params, json=payload
        )

    # -- internals ----------------------------------------------------------

    def _request(self, method: str, path: str, params: dict | None = None,
                  json: dict | None = None, tenant_scoped: bool = True,
                  _retried_after_reauth: bool = False) -> dict:
        params = dict(params or {})
        if tenant_scoped:
            params.setdefault("tenant_id", self.tenant_id)

        headers = {"apikey": self.api_key}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"

        resp = self.session.request(
            method, f"{self.base_url}{path}", params=params, json=json,
            headers=headers, timeout=self.timeout,
        )

        # The docs don't confirm refresh_token works on this endpoint for
        # user auth (only documented for the partner flow) -- fall back to a
        # full re-login on 401, once, rather than assuming refresh works.
        if resp.status_code == 401 and self._email and not _retried_after_reauth:
            self.authenticate(self._email, self._password)  # type: ignore[arg-type]
            return self._request(method, path, params=params, json=json,
                                  tenant_scoped=False, _retried_after_reauth=True)

        if resp.status_code >= 400:
            raise RatiosAPIError(resp)
        if resp.status_code == 204 or not resp.content:
            return {}
        return resp.json()


def rate_limit_probe(client: RatiosClient, resource: str = "tenants",
                      count: int = 20, interval: float = 0.25) -> list[int]:
    """Sends a small burst of read-only requests and returns the status codes seen.
    Use against a sandbox only -- see TESTING_PLAN.md section 7."""
    codes = []
    for _ in range(count):
        try:
            client._request("GET", f"/functions/v1/api/{resource}", tenant_scoped=(resource != "tenants"))
            codes.append(200)
        except RatiosAPIError as e:
            codes.append(e.status_code)
        time.sleep(interval)
    return codes
