"""Create the hosted Supabase project for Data Loom and set it up (the setup that was run on
2026-11-02). It:

  1. creates a free-plan project named PROJECT_NAME (or reuses one with that name),
  2. waits until it is healthy and turns on anonymous sign-ins,
  3. applies every file in migrations/ through the Management API's SQL endpoint and records
     them in supabase_migrations.schema_migrations, so `supabase db push` agrees later,
  4. checks what exists, and writes apps/mobile/.env.local (project URL + the PUBLIC key only).

Needs three environment variables:
  SUPABASE_ACCESS_TOKEN  a personal access token (full account access: read it from your
                         password manager into the environment, never into a file or argv)
  SB_ORG_SLUG            the organization slug (GET /v1/organizations lists it)
  SB_REGION              e.g. eu-central-1 (cannot be changed later; measure latency first)

It never prints the token, the database password (random, used once, not stored; reset it in
the dashboard if you ever need it) or any API key, and it never reads out the service-role key.
Run:  SUPABASE_ACCESS_TOKEN=... SB_ORG_SLUG=... SB_REGION=... python3 -I provision.py
"""
import json
import os
import pathlib
import re
import secrets
import sys
import time
import urllib.error
import urllib.request

TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
ORG_SLUG = os.environ["SB_ORG_SLUG"]
REGION = os.environ["SB_REGION"]
REPO = str(pathlib.Path(__file__).resolve().parents[3])  # tools -> supabase -> file-share-rtc -> repo
PROJECT_NAME = "data-loom"
API = "https://api.supabase.com/v1"


def call(method, path, body=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "fileshare-setup/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:400]
    except Exception as e:  # network trouble
        return 0, str(e)[:300]


def step(msg):
    print(f"\n== {msg}", flush=True)


# 1. Project ---------------------------------------------------------------------------
step("project")
status, projects = call("GET", "/projects")
assert status == 200, f"listing projects failed: {status} {projects}"
existing = [p for p in projects if p["name"] == PROJECT_NAME]
if existing:
    ref = existing[0]["id"]
    print(f"reusing existing project {PROJECT_NAME!r} (status {existing[0].get('status')})")
else:
    db_pass = secrets.token_urlsafe(24)  # used once, never printed or stored
    status, created = call(
        "POST",
        "/projects",
        {
            "name": PROJECT_NAME,
            "organization_slug": ORG_SLUG,
            "db_pass": db_pass,
            "plan": "free",
            "region": REGION,
        },
    )
    del db_pass
    if status not in (200, 201):
        print("CREATE FAILED:", status, json.dumps(created)[:500])
        sys.exit(1)
    ref = created["id"]
    print(f"created {PROJECT_NAME!r}: region={created.get('region')} status={created.get('status')}")

deadline = time.time() + 600
last = None
while time.time() < deadline:
    status, proj = call("GET", f"/projects/{ref}")
    state = proj.get("status") if isinstance(proj, dict) else f"HTTP {status}"
    if state != last:
        print(f"  status: {state}", flush=True)
        last = state
    if state == "ACTIVE_HEALTHY":
        break
    time.sleep(10)
else:
    print("TIMED OUT waiting for the project to become healthy")
    sys.exit(1)

# 2. Auth: anonymous sign-ins -----------------------------------------------------------
step("anonymous sign-ins")
status, resp = call("PATCH", f"/projects/{ref}/config/auth", {"external_anonymous_users_enabled": True})
print("PATCH:", status, "" if status == 200 else json.dumps(resp)[:300])
status, cfg = call("GET", f"/projects/{ref}/config/auth")
if isinstance(cfg, dict):
    print("external_anonymous_users_enabled =", cfg.get("external_anonymous_users_enabled"),
          "| rate_limit_anonymous_users =", cfg.get("rate_limit_anonymous_users"))


# 3. Migrations -------------------------------------------------------------------------
def sql(query, retries=6):
    for attempt in range(retries):
        status, resp = call("POST", f"/projects/{ref}/database/query", {"query": query})
        if status in (200, 201):
            return resp
        transient = status == 0 or status >= 500 or (isinstance(resp, dict) and "not ready" in json.dumps(resp).lower())
        if transient and attempt < retries - 1:
            time.sleep(8)
            continue
        raise RuntimeError(f"HTTP {status}: {json.dumps(resp)[:700]}")


step("migrations")
mig_dir = os.path.join(REPO, "file-share-rtc", "supabase", "migrations")
files = sorted(f for f in os.listdir(mig_dir) if f.endswith(".sql"))
already = set()
try:
    rows = sql("select version from supabase_migrations.schema_migrations")
    already = {r["version"] for r in rows}
except RuntimeError:
    pass  # table does not exist yet: nothing has been applied

sql(
    "create schema if not exists supabase_migrations;"
    "create table if not exists supabase_migrations.schema_migrations (version text not null primary key);"
    "alter table supabase_migrations.schema_migrations add column if not exists statements text[];"
    "alter table supabase_migrations.schema_migrations add column if not exists name text;"
)
for f in files:
    m = re.match(r"^(\d+)_(.+)\.sql$", f)
    version, name = m.group(1), m.group(2)
    if version in already:
        print(f"  skip {f} (already applied)")
        continue
    body = open(os.path.join(mig_dir, f)).read()
    try:
        sql(body)
    except RuntimeError as e:
        print(f"  FAILED {f}: {e}")
        sys.exit(1)
    sql(
        "insert into supabase_migrations.schema_migrations (version, name, statements) "
        f"values ('{version}', '{name}', '{{}}') on conflict (version) do nothing"
    )
    print(f"  applied {f}")

# 4. Verify what exists -----------------------------------------------------------------
step("verify")
print("tables (rls on?):", [(r["relname"], r["relrowsecurity"]) for r in sql(
    "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace "
    "where n.nspname='public' and c.relkind='r' order by 1")])
print("functions:", [r["proname"] for r in sql(
    "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1")])
print("realtime publication:", [r["tablename"] for r in sql(
    "select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' order by 1")])
print("migration history:", [r["version"] for r in sql("select version from supabase_migrations.schema_migrations order by 1")])
print("anon may execute create_pairing_code?:", sql("select has_function_privilege('anon','public.create_pairing_code()','execute') as x")[0]["x"],
      "| authenticated may?:", sql("select has_function_privilege('authenticated','public.create_pairing_code()','execute') as x")[0]["x"])

# 5. Keys -> .env.local (only the public key; the service-role key is never read out) ---------
step("app configuration")
status, keys = call("GET", f"/projects/{ref}/api-keys")
assert status == 200 and isinstance(keys, list), f"api-keys failed: {status}"
print("key kinds available:", sorted({f"{k.get('type')}/{k.get('name')}" for k in keys}))
public = next((k for k in keys if k.get("type") == "publishable"), None) or next((k for k in keys if k.get("name") == "anon"), None)
assert public and public.get("api_key"), "no public (publishable/anon) key found"
print("using key kind:", f"{public.get('type')}/{public.get('name')}")
env_path = os.path.join(REPO, "apps", "mobile", ".env.local")
with open(env_path, "w") as fh:
    fh.write("# Written by the Supabase setup. Gitignored. Public values only.\n")
    fh.write(f"EXPO_PUBLIC_SUPABASE_URL=https://{ref}.supabase.co\n")
    fh.write(f"EXPO_PUBLIC_SUPABASE_ANON_KEY={public['api_key']}\n")
os.chmod(env_path, 0o600)
print("wrote", env_path.replace(os.path.expanduser("~"), "~"), "(project ref and key not shown)")
print("\nDONE")
