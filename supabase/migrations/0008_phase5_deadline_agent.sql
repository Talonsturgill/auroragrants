-- 0008_phase5_deadline_agent.sql
-- Phase 5A: deadline agent support columns.
--
-- Adds:
--   deadlines.ack_token             uuid unique (signed ack links, no login required)
--   tenants.primary_phone           text (for SMS reminders)
--   tenants.deadline_radar_enabled  boolean (opt-out of weekly digest)
--   tenants.radar_send_hour         int    (local hour 0-23 for weekly send)
--
-- Idempotent: safe to re-run.

begin;

-- ----- deadlines.ack_token --------------------------------------------------
-- Token-based acknowledgement link. No login required. The link is sent in
-- every notification email. GET /api/deadlines/ack/{token} flips acknowledged.

alter table deadlines
  add column if not exists ack_token uuid unique default gen_random_uuid();

-- Backfill any existing rows that have no token (null from before migration).
update deadlines set ack_token = gen_random_uuid() where ack_token is null;

-- ----- tenants: phone, radar opt-out, send hour ----------------------------

alter table tenants
  add column if not exists primary_phone text;

alter table tenants
  add column if not exists deadline_radar_enabled boolean not null default true;

alter table tenants
  add column if not exists radar_send_hour int not null default 9;

-- Constrain radar_send_hour to valid 24-hour range.
do $$
declare cname text;
begin
  select c.conname into cname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
  where t.relname = 'tenants'
    and c.contype = 'c'
    and a.attname = 'radar_send_hour'
  limit 1;
  if cname is null then
    execute 'alter table tenants add constraint tenants_radar_send_hour_check check (radar_send_hour >= 0 and radar_send_hour <= 23)';
  end if;
end;
$$;

commit;
