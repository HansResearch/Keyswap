-- Run this in Supabase SQL editor (or via psql)

create table if not exists keys (
  name              text primary key,            -- e.g. "satoshi"
  creator_wallet    text not null,               -- base58 public key
  subject_name_pda  text unique,                 -- base58 PDA for trade disambiguation
  pfp_url           text,                        -- R2 CDN URL or null
  supply            integer not null default 1,
  price_floor       bigint  not null default 0,  -- lamports
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists trades (
  id          bigserial primary key,
  name        text not null references keys(name) on delete cascade,
  tx_sig      text not null unique,
  trade_type  text not null check (trade_type in ('BUY', 'SELL', 'CREATE')),
  trader      text not null,   -- base58
  amount      integer not null,
  price_sol   bigint not null, -- lamports
  block_time  timestamptz,
  created_at  timestamptz not null default now()
);

-- Indexes for common queries
create index if not exists trades_name_idx      on trades(name);
create index if not exists trades_block_time_idx on trades(block_time desc);
create index if not exists keys_updated_at_idx  on keys(updated_at desc);

-- Auto-update updated_at
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists keys_touch on keys;
create trigger keys_touch
  before update on keys
  for each row execute procedure touch_updated_at();
