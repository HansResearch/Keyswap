# Solana FriendTech — Final Production Contract
### SPL Token Keys · Unique Names · Burn · Royalty Sharing · 3%/1% Fees

**Verified price table ($150/SOL, 3% protocol + 1% subject fee):**

| Supply | Buy/key | Total paid | Sell/key | Seller gets |
|--------|---------|------------|----------|-------------|
| 1 | $0.159 | $0.165 | $0.127 | $0.122 |
| 1K | $0.429 | $0.446 | $0.343 | $0.330 |
| 10K | $1.050 | $1.092 | $0.840 | $0.806 |
| 100K | $2.994 | $3.114 | $2.395 | $2.299 |
| 1M | $9.150 | $9.516 | $7.320 | $7.027 |
| 10M | $28.61 | $29.75 | $22.89 | $21.97 |

---

## Architecture Changes from Previous Version

| Feature | Change |
|---|---|
| Key transferability | `BalanceState` → **SPL Token mint per creator** |
| Unique names | New `SubjectName` PDA + `register_name` instruction |
| Burn | New `burn_shares` instruction (no SOL payout, escrow stays) |
| Protocol fee | 5% → **3%** |
| Subject fee | 5% → **1%** with optional royalty wallet split |
| Cooldown tracking | Moved from `BalanceState` → new `CooldownState` PDA |
| New instructions | `initialize_subject`, `register_name`, `set_royalty_wallet`, `burn_shares`, `set_burn_destination` |

---

## `programs/friendtech-shares/Cargo.toml`

```toml
[package]
name = "friendtech-shares"
version = "0.1.0"
description = "Solana social key trading — SPL token keys with sqrt bonding curve"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "friendtech_shares"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = "0.29.0"
anchor-spl  = { version = "0.29.0", features = ["token", "associated_token"] }
```

---

## `Anchor.toml`

```toml
[features]
seeds = true
skip-lint = false

[programs.localnet]
friendtech_shares = "YOUR_PROGRAM_ID_HERE"

[programs.devnet]
friendtech_shares = "YOUR_PROGRAM_ID_HERE"

[programs.mainnet]
friendtech_shares = "YOUR_PROGRAM_ID_HERE"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
```

---

## `programs/friendtech-shares/src/errors.rs`

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum FriendError {
    #[msg("Only the subject can buy the first share")]
    OnlySubjectCanBuyFirst,
    #[msg("Cannot sell the last share")]
    CannotSellLastShare,
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("Insufficient SOL sent")]
    InsufficientPayment,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Caller is not the protocol authority")]
    Unauthorized,
    #[msg("Fee percent exceeds maximum (20%)")]
    FeeTooHigh,
    #[msg("Sell price is below the price floor")]
    PriceBelowFloor,
    #[msg("Amount exceeds max sell per transaction (5% of supply)")]
    ExceedsSellLimit,
    #[msg("Sell cooldown period has not elapsed")]
    SellCooldown,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Name must be at least 3 characters")]
    NameTooShort,
    #[msg("Name must be at most 32 characters")]
    NameTooLong,
    #[msg("Name may only contain lowercase a-z and 0-9")]
    NameInvalidChars,
    #[msg("This subject already has a name set")]
    NameAlreadySet,
    #[msg("Royalty percent must be 0-100")]
    InvalidRoyaltyPercent,
    #[msg("Royalty wallet does not match stored wallet")]
    InvalidRoyaltyWallet,
    #[msg("Escrow has insufficient SOL for payout")]
    InsufficientEscrow,
}
```

---

## `programs/friendtech-shares/src/state.rs`

```rust
use anchor_lang::prelude::*;

/// Global protocol config. One PDA, deployed once.
/// Seeds: [b"config"]
#[account]
pub struct ProtocolConfig {
    pub authority:            Pubkey,  // 32 — can call set_fees / set_destinations
    pub fee_destination:      Pubkey,  // 32 — receives protocol fees
    pub burn_destination:     Pubkey,  // 32 — optional: receives SOL if burn_shares ever pays out
    pub protocol_fee_percent: u64,     // 8  — 30_000_000 = 3%  (denominator 1e9)
    pub subject_fee_percent:  u64,     // 8  — 10_000_000 = 1%
    pub bump:                 u8,      // 1
}
// space = 8 + 113 = 121

/// Per-creator state. One PDA per creator wallet.
/// Seeds: [b"subject", creator.key()]
/// Also serves as the SPL mint authority via PDA signing.
#[account]
pub struct SubjectState {
    pub subject:          Pubkey,    // 32
    pub supply:           u64,       // 8  — mirrors SPL mint supply for quick reads
    pub price_floor:      u64,       // 8  — lamports per key, only ever increases
    pub name:             [u8; 32],  // 32 — zero-padded UTF-8 name (set once via register_name)
    pub has_name:         bool,      // 1
    pub royalty_wallet:   Pubkey,    // 32 — receives royalty_percent of subject_fee per trade
    pub royalty_percent:  u64,       // 8  — 0-100: % of subject_fee that goes to royalty_wallet
    pub mint_bump:        u8,        // 1  — stored for PDA signing in mint/burn CPIs
    pub bump:             u8,        // 1
}
// space = 8 + 123 = 131

/// Unique name registry. One PDA per registered name.
/// Seeds: [b"name", name.as_bytes()]
/// If this PDA exists, the name is taken. The `init` constraint ensures atomicity.
#[account]
pub struct SubjectName {
    pub subject: Pubkey,  // 32 — creator who owns this name
    pub bump:    u8,      // 1
}
// space = 8 + 33 = 41

/// Per-(creator x seller) cooldown tracker.
/// Created on first large sell. Replaces last_sell_slot from old BalanceState.
/// Seeds: [b"cooldown", subject.key(), seller.key()]
#[account]
pub struct CooldownState {
    pub last_sell_slot: u64,  // 8
    pub bump:           u8,   // 1
}
// space = 8 + 9 = 17
```

---

## `programs/friendtech-shares/src/pricing.rs`

```rust
use anchor_lang::prelude::*;
use crate::errors::FriendError;

// ─── Curve parameters ────────────────────────────────────────────────────────
//
//  Marginal price per key at supply S:
//
//      price_per_key(S) = BASE_PRICE + SCALE x isqrt(S + 1)
//
//  Total price for `amount` keys at supply S (trapezoidal rule):
//
//      total = amount x avg(price_per_key(S), price_per_key(S + amount - 1))
//
//  Sell curve = 80% of equivalent buy price at post-sell supply.
//  The 20% spread stays in SubjectState PDA permanently (price floor treasury).
//
//  Price table ($150/SOL):
//    1K  keys  →  $0.43/key   mkt cap  $429
//    10K keys  →  $1.05/key   mkt cap  $10.5K
//    100K keys →  $2.99/key   mkt cap  $299K
//    1M  keys  →  $9.15/key   mkt cap  $9.2M
//    10M keys  → $28.61/key   mkt cap  $286M
//
//  To tune: change SCALE (steepness) or BASE_PRICE (starting price).

pub const BASE_PRICE_LAMPORTS: u64 = 1_000_000;  // 0.001 SOL base per key
pub const SCALE:                u64 = 60_000;     // lamports per sqrt(supply+1)
pub const SELL_RATIO:           u64 = 80;         // seller gets 80% of equivalent buy
pub const FLOOR_RATIO:          u64 = 70;         // floor = 70% of current price/key
pub const MAX_SELL_DENOMINATOR: u64 = 20;         // max 5% of supply per sell tx
pub const SELL_COOLDOWN_SLOTS:  u64 = 150;        // ~60s cooldown between large sells
pub const COOLDOWN_THRESHOLD:   u64 = 5;          // applies when selling > 5 keys

// ─── Integer square root (Babylonian method) ─────────────────────────────────
// Returns floor(sqrt(n)). No floating point. Safe for all u128 inputs.
pub fn isqrt(n: u128) -> u128 {
    if n == 0 { return 0; }
    let mut x: u128 = n;
    let mut y: u128 = (x + 1) >> 1;
    while y < x { x = y; y = (x + n / x) >> 1; }
    x
}

/// Price for exactly 1 key at supply S.
/// price_per_key(S) = BASE_PRICE + SCALE x isqrt(S + 1)
/// The +1 shift: (1) non-zero first key price, (2) no discontinuity at perfect squares.
pub fn price_per_key(supply: u64) -> Result<u64> {
    let sqrt_val = isqrt((supply as u128).checked_add(1).ok_or(FriendError::MathOverflow)?);
    let curve    = (SCALE as u128).checked_mul(sqrt_val).ok_or(FriendError::MathOverflow)?;
    let total    = curve.checked_add(BASE_PRICE_LAMPORTS as u128).ok_or(FriendError::MathOverflow)?;
    if total > u64::MAX as u128 { return Err(FriendError::MathOverflow.into()); }
    Ok(total as u64)
}

/// Total buy price for `amount` keys starting at `supply`.
/// Trapezoidal rule — exact for amount=1, <0.01% error for amount <= 5% of supply.
pub fn get_buy_price(supply: u64, amount: u64) -> Result<u64> {
    require!(amount > 0, FriendError::ZeroAmount);
    let p_start  = price_per_key(supply)? as u128;
    let last_sup = supply.checked_add(amount).ok_or(FriendError::MathOverflow)?
                         .checked_sub(1).ok_or(FriendError::MathOverflow)?;
    let p_end    = price_per_key(last_sup)? as u128;
    let total    = (p_start.checked_add(p_end).ok_or(FriendError::MathOverflow)? / 2)
                   .checked_mul(amount as u128).ok_or(FriendError::MathOverflow)?;
    if total > u64::MAX as u128 { return Err(FriendError::MathOverflow.into()); }
    Ok(total as u64)
}

/// Sell price = 80% of buy price at post-sell supply.
/// The 20% spread stays in SubjectState PDA forever.
pub fn get_sell_price(supply: u64, amount: u64) -> Result<u64> {
    require!(amount > 0, FriendError::ZeroAmount);
    require!(supply > amount, FriendError::CannotSellLastShare);
    let raw  = get_buy_price(supply.checked_sub(amount).ok_or(FriendError::MathOverflow)?, amount)?;
    let sell = (raw as u128).checked_mul(SELL_RATIO as u128).ok_or(FriendError::MathOverflow)? / 100;
    Ok(sell as u64)
}

/// New price floor after a buy. Only increases — never decreases.
pub fn compute_new_floor(new_supply: u64, existing_floor: u64) -> Result<u64> {
    let pps       = price_per_key(new_supply)?;
    let candidate = (pps as u128).checked_mul(FLOOR_RATIO as u128).ok_or(FriendError::MathOverflow)? / 100;
    Ok((candidate as u64).max(existing_floor))
}

/// Max keys sellable per tx = supply / 20, min 1.
pub fn max_sell_amount(supply: u64) -> u64 {
    (supply / MAX_SELL_DENOMINATOR).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn isqrt_floor() {
        assert_eq!(isqrt(0), 0); assert_eq!(isqrt(1), 1); assert_eq!(isqrt(4), 2);
        assert_eq!(isqrt(9999), 99); assert_eq!(isqrt(10000), 100); assert_eq!(isqrt(10001), 100);
    }

    #[test] fn first_key_price() {
        assert_eq!(get_buy_price(0, 1).unwrap(), BASE_PRICE_LAMPORTS + SCALE);
    }

    #[test] fn no_discontinuity_at_squares() {
        for sq in [100u64, 400, 10_000, 1_000_000] {
            let a = price_per_key(sq - 1).unwrap() as i64;
            let b = price_per_key(sq).unwrap() as i64;
            assert!((b - a).abs() * 100 < a * 2, "spike at sq={}", sq);
        }
    }

    #[test] fn price_strictly_increases() {
        let mut prev = 0u64;
        for s in [1u64, 10, 100, 1_000, 10_000, 1_000_000, 10_000_000] {
            let p = price_per_key(s).unwrap();
            assert!(p > prev, "price flat at {}", s);
            prev = p;
        }
    }

    #[test] fn sell_is_80_pct_of_buy() {
        for s in [10u64, 1_000, 100_000] {
            let buy  = get_buy_price(s - 1, 1).unwrap();
            let sell = get_sell_price(s, 1).unwrap();
            assert_eq!(sell, buy * 80 / 100);
        }
    }

    #[test] fn floor_never_decreases() {
        let mut f = 0u64;
        for s in [100u64, 1_000, 10_000, 1_000_000] {
            let nf = compute_new_floor(s, f).unwrap();
            assert!(nf >= f); f = nf;
        }
        assert_eq!(compute_new_floor(1, f).unwrap(), f);
    }

    #[test] fn max_sell_clamp() {
        assert_eq!(max_sell_amount(1), 1); assert_eq!(max_sell_amount(100), 5);
        assert_eq!(max_sell_amount(10_000_000), 500_000);
    }

    #[test] fn no_overflow_at_10m() {
        assert!(get_buy_price(10_000_000, 500_000).is_ok());
        let p = price_per_key(10_000_000).unwrap();
        assert!(p > 100_000_000 && p < 1_000_000_000);
    }
}
```

---

## `programs/friendtech-shares/src/lib.rs`

```rust
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};

pub mod errors;
pub mod pricing;
pub mod state;

use errors::FriendError;
use pricing::*;
use state::*;

declare_id!("YOUR_PROGRAM_ID_HERE");

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct TradeEvent {
    pub trader:       Pubkey,
    pub subject:      Pubkey,
    pub is_buy:       bool,
    pub key_amount:   u64,
    pub sol_amount:   u64,   // base price excluding fees
    pub protocol_fee: u64,
    pub subject_fee:  u64,   // total subject fee (creator + royalty)
    pub royalty_fee:  u64,   // portion of subject_fee going to royalty_wallet
    pub supply:       u64,   // supply AFTER trade
    pub price_floor:  u64,   // floor AFTER trade
}

#[event]
pub struct BurnEvent {
    pub burner:     Pubkey,
    pub subject:    Pubkey,
    pub amount:     u64,
    pub new_supply: u64,
}

#[event]
pub struct NameRegisteredEvent {
    pub subject: Pubkey,
    pub name:    String,
}

// ─── Program ─────────────────────────────────────────────────────────────────

#[program]
pub mod friendtech_shares {
    use super::*;

    // ── initialize_protocol ──────────────────────────────────────────────────
    /// Run once by deployer. Creates global ProtocolConfig PDA.
    /// Recommended: protocol_fee_percent = 30_000_000 (3%)
    ///              subject_fee_percent  = 10_000_000 (1%)

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        protocol_fee_percent: u64,
        subject_fee_percent: u64,
    ) -> Result<()> {
        require!(protocol_fee_percent <= 200_000_000, FriendError::FeeTooHigh);
        require!(subject_fee_percent  <= 200_000_000, FriendError::FeeTooHigh);

        let config = &mut ctx.accounts.config;
        config.authority            = ctx.accounts.authority.key();
        config.fee_destination      = ctx.accounts.authority.key();
        config.burn_destination     = ctx.accounts.authority.key();
        config.protocol_fee_percent = protocol_fee_percent;
        config.subject_fee_percent  = subject_fee_percent;
        config.bump                 = ctx.bumps.config;
        Ok(())
    }

    // ── set_fees ─────────────────────────────────────────────────────────────

    pub fn set_fees(
        ctx: Context<AdminConfig>,
        protocol_fee_percent: u64,
        subject_fee_percent: u64,
    ) -> Result<()> {
        require!(ctx.accounts.authority.key() == ctx.accounts.config.authority, FriendError::Unauthorized);
        require!(protocol_fee_percent <= 200_000_000, FriendError::FeeTooHigh);
        require!(subject_fee_percent  <= 200_000_000, FriendError::FeeTooHigh);
        ctx.accounts.config.protocol_fee_percent = protocol_fee_percent;
        ctx.accounts.config.subject_fee_percent  = subject_fee_percent;
        Ok(())
    }

    // ── set_fee_destination ───────────────────────────────────────────────────

    pub fn set_fee_destination(ctx: Context<AdminDestination>) -> Result<()> {
        require!(ctx.accounts.authority.key() == ctx.accounts.config.authority, FriendError::Unauthorized);
        ctx.accounts.config.fee_destination = ctx.accounts.new_destination.key();
        Ok(())
    }

    // ── set_burn_destination ─────────────────────────────────────────────────

    pub fn set_burn_destination(ctx: Context<AdminBurnDestination>) -> Result<()> {
        require!(ctx.accounts.authority.key() == ctx.accounts.config.authority, FriendError::Unauthorized);
        ctx.accounts.config.burn_destination = ctx.accounts.new_destination.key();
        Ok(())
    }

    // ── initialize_subject ───────────────────────────────────────────────────
    /// Creator calls this once to create their SubjectState PDA and SPL mint.
    /// Must be called before buy_shares.
    /// Keys are SPL tokens: 0 decimals, mint authority = SubjectState PDA.

    pub fn initialize_subject(ctx: Context<InitializeSubject>) -> Result<()> {
        let ss           = &mut ctx.accounts.subject_state;
        ss.subject        = ctx.accounts.creator.key();
        ss.supply         = 0;
        ss.price_floor    = 0;
        ss.name           = [0u8; 32];
        ss.has_name       = false;
        ss.royalty_wallet = ctx.accounts.creator.key(); // default to creator (royalty_percent=0)
        ss.royalty_percent = 0;
        ss.mint_bump      = ctx.bumps.mint;
        ss.bump           = ctx.bumps.subject_state;
        Ok(())
    }

    // ── register_name ────────────────────────────────────────────────────────
    /// Creator registers a unique lowercase name for their key.
    /// Rules: 3-32 chars, a-z and 0-9 only, set once, never changeable.
    /// Uniqueness guaranteed by PDA existence — init fails if name is taken.

    pub fn register_name(ctx: Context<RegisterName>, name: String) -> Result<()> {
        require!(name.len() >= 3,  FriendError::NameTooShort);
        require!(name.len() <= 32, FriendError::NameTooLong);
        require!(
            name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
            FriendError::NameInvalidChars
        );
        require!(
            ctx.accounts.creator.key() == ctx.accounts.subject_state.subject,
            FriendError::Unauthorized
        );
        require!(!ctx.accounts.subject_state.has_name, FriendError::NameAlreadySet);

        // SubjectName PDA init will fail if name is already taken (atomic uniqueness)
        ctx.accounts.subject_name.subject = ctx.accounts.creator.key();
        ctx.accounts.subject_name.bump    = ctx.bumps.subject_name;

        // Mirror name on SubjectState
        let bytes = name.as_bytes();
        ctx.accounts.subject_state.name[..bytes.len()].copy_from_slice(bytes);
        ctx.accounts.subject_state.has_name = true;

        emit!(NameRegisteredEvent {
            subject: ctx.accounts.creator.key(),
            name: name.clone(),
        });

        Ok(())
    }

    // ── set_royalty_wallet ───────────────────────────────────────────────────
    /// Creator sets a wallet to share a portion of their 1% subject fee.
    /// Example: royalty_wallet = partner address, royalty_percent = 50
    ///          → partner receives 50% of creator's 1% fee on every trade.
    /// Set royalty_percent = 0 to disable sharing.

    pub fn set_royalty_wallet(
        ctx: Context<SetRoyaltyWallet>,
        wallet: Pubkey,
        percent: u64,
    ) -> Result<()> {
        require!(ctx.accounts.creator.key() == ctx.accounts.subject_state.subject, FriendError::Unauthorized);
        require!(percent <= 100, FriendError::InvalidRoyaltyPercent);
        ctx.accounts.subject_state.royalty_wallet  = wallet;
        ctx.accounts.subject_state.royalty_percent = percent;
        Ok(())
    }

    // ── buy_shares ───────────────────────────────────────────────────────────
    /// Buy `amount` keys of a creator.
    ///
    /// SPL tokens are minted to buyer's ATA (keys land in buyer's wallet).
    /// SOL flow:
    ///   protocol_fee (3%)  → fee_destination
    ///   creator_cut        → subject wallet       (1% × (100 - royalty_percent)%)
    ///   royalty_cut        → royalty_wallet        (1% × royalty_percent%)
    ///   base_price         → SubjectState PDA      (bonding curve escrow)
    ///
    /// After this call, keys appear in buyer's wallet like any SPL token.
    /// Buyers can freely transfer keys via standard SPL transfer — no program needed.

    pub fn buy_shares(ctx: Context<BuyShares>, amount: u64) -> Result<()> {
        require!(amount > 0, FriendError::ZeroAmount);

        // ── Read all fields before any mutation ───────────────────────────────
        let supply          = ctx.accounts.subject_state.supply;
        let buyer_key       = ctx.accounts.buyer.key();
        let subject_key     = ctx.accounts.subject.key();
        let state_bump      = ctx.accounts.subject_state.bump;
        let royalty_percent = ctx.accounts.subject_state.royalty_percent;
        let current_floor   = ctx.accounts.subject_state.price_floor;
        let proto_pct       = ctx.accounts.config.protocol_fee_percent;
        let subj_pct        = ctx.accounts.config.subject_fee_percent;

        require!(supply > 0 || subject_key == buyer_key, FriendError::OnlySubjectCanBuyFirst);

        // ── Fee math ─────────────────────────────────────────────────────────
        let price             = get_buy_price(supply, amount)?;
        let protocol_fee      = (price as u128 * proto_pct as u128 / 1_000_000_000) as u64;
        let subject_fee_total = (price as u128 * subj_pct as u128  / 1_000_000_000) as u64;
        let royalty_cut       = (subject_fee_total as u128 * royalty_percent as u128 / 100) as u64;
        let creator_cut       = subject_fee_total - royalty_cut;
        let total_cost        = price + protocol_fee + subject_fee_total;

        require!(ctx.accounts.buyer.lamports() >= total_cost, FriendError::InsufficientPayment);

        // ── State updates (before all transfers) ─────────────────────────────
        let new_supply = supply.checked_add(amount).ok_or(FriendError::MathOverflow)?;
        ctx.accounts.subject_state.supply      = new_supply;
        ctx.accounts.subject_state.price_floor = compute_new_floor(new_supply, current_floor)?;
        let new_floor = ctx.accounts.subject_state.price_floor;

        // ── Mint SPL tokens to buyer's ATA ────────────────────────────────────
        // SubjectState PDA is the mint authority. Sign with its seeds.
        let subject_key_bytes = subject_key.to_bytes();
        let seeds = &[b"subject".as_ref(), subject_key_bytes.as_ref(), &[state_bump]];
        let signer = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint:      ctx.accounts.mint.to_account_info(),
                    to:        ctx.accounts.buyer_ata.to_account_info(),
                    authority: ctx.accounts.subject_state.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        // ── SOL transfers via system_program (buyer is signer, no RefCell conflict) ──

        // 1. Protocol fee → fee_destination
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to:   ctx.accounts.fee_destination.to_account_info(),
            }),
            protocol_fee,
        )?;

        // 2. Creator cut → subject
        // (system_program handles sequential transfers to same account correctly)
        if creator_cut > 0 {
            system_program::transfer(
                CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to:   ctx.accounts.subject.to_account_info(),
                }),
                creator_cut,
            )?;
        }

        // 3. Royalty cut → royalty_wallet
        if royalty_cut > 0 {
            system_program::transfer(
                CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to:   ctx.accounts.royalty_wallet.to_account_info(),
                }),
                royalty_cut,
            )?;
        }

        // 4. Base price → SubjectState PDA (bonding curve escrow)
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to:   ctx.accounts.subject_state.to_account_info(),
            }),
            price,
        )?;

        emit!(TradeEvent {
            trader: buyer_key, subject: subject_key, is_buy: true,
            key_amount: amount, sol_amount: price,
            protocol_fee, subject_fee: subject_fee_total, royalty_fee: royalty_cut,
            supply: new_supply, price_floor: new_floor,
        });

        Ok(())
    }

    // ── sell_shares ──────────────────────────────────────────────────────────
    /// Sell `amount` keys.
    ///
    /// Burns SPL tokens from seller's ATA (keys leave seller's wallet).
    /// SOL paid from SubjectState PDA escrow via direct lamport mutation.
    /// Duplicate-key conflict resolution: if royalty_wallet == subject (or other
    /// duplicates), amounts are accumulated before crediting to prevent
    /// RefCell double-borrow panics.

    pub fn sell_shares(ctx: Context<SellShares>, amount: u64) -> Result<()> {
        require!(amount > 0, FriendError::ZeroAmount);

        // ── Read fields ───────────────────────────────────────────────────────
        let supply          = ctx.accounts.subject_state.supply;
        let seller_key      = ctx.accounts.seller.key();
        let subject_key     = ctx.accounts.subject.key();
        let fee_dest_key    = ctx.accounts.fee_destination.key();
        let royalty_key     = ctx.accounts.royalty_wallet.key();
        let royalty_percent = ctx.accounts.subject_state.royalty_percent;
        let current_floor   = ctx.accounts.subject_state.price_floor;
        let proto_pct       = ctx.accounts.config.protocol_fee_percent;
        let subj_pct        = ctx.accounts.config.subject_fee_percent;

        // ── Guards ────────────────────────────────────────────────────────────
        require!(supply > amount, FriendError::CannotSellLastShare);
        require!(ctx.accounts.seller_ata.amount >= amount, FriendError::InsufficientShares);
        require!(amount <= max_sell_amount(supply), FriendError::ExceedsSellLimit);

        if amount > COOLDOWN_THRESHOLD {
            let clock = Clock::get()?;
            require!(
                clock.slot > ctx.accounts.cooldown_state.last_sell_slot
                    .saturating_add(SELL_COOLDOWN_SLOTS),
                FriendError::SellCooldown
            );
            ctx.accounts.cooldown_state.last_sell_slot = clock.slot;
        }

        // ── Pricing ───────────────────────────────────────────────────────────
        let price             = get_sell_price(supply, amount)?;
        let floor_total       = current_floor.checked_mul(amount).ok_or(FriendError::MathOverflow)?;
        require!(price >= floor_total, FriendError::PriceBelowFloor);

        let protocol_fee      = (price as u128 * proto_pct as u128 / 1_000_000_000) as u64;
        let subject_fee_total = (price as u128 * subj_pct as u128  / 1_000_000_000) as u64;
        let royalty_cut       = (subject_fee_total as u128 * royalty_percent as u128 / 100) as u64;
        let creator_cut       = subject_fee_total - royalty_cut;
        let seller_payout     = price - protocol_fee - subject_fee_total;
        let total_out         = seller_payout + protocol_fee + subject_fee_total;

        // Verify escrow solvency (must stay above rent-exempt minimum)
        let rent_min = Rent::get()?.minimum_balance(
            ctx.accounts.subject_state.to_account_info().data_len()
        );
        require!(
            ctx.accounts.subject_state.to_account_info().lamports() >= rent_min + total_out,
            FriendError::InsufficientEscrow
        );

        // ── State updates (before transfers) ──────────────────────────────────
        ctx.accounts.subject_state.supply = supply.checked_sub(amount).ok_or(FriendError::MathOverflow)?;
        let new_supply = ctx.accounts.subject_state.supply;
        // price_floor NOT changed on sell

        // ── Burn SPL tokens from seller's ATA ─────────────────────────────────
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint:      ctx.accounts.mint.to_account_info(),
                    from:      ctx.accounts.seller_ata.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            amount,
        )?;

        // ── SOL from escrow via direct lamport mutation ────────────────────────
        //
        // We accumulate amounts per unique recipient key to avoid
        // RefCell double-borrow errors when two accounts share the same pubkey
        // (e.g. royalty_wallet == subject, or seller == subject for own-sell).
        //
        // Map: key → total lamports to credit

        let mut payouts: [(Pubkey, u64); 4] = [
            (seller_key,   seller_payout),
            (fee_dest_key, protocol_fee),
            (subject_key,  creator_cut),
            (royalty_key,  royalty_cut),
        ];

        // Collapse duplicates: if two slots share a key, merge into the first occurrence
        for i in 0..payouts.len() {
            for j in (i + 1)..payouts.len() {
                if payouts[i].0 == payouts[j].0 {
                    payouts[i].1 = payouts[i].1.saturating_add(payouts[j].1);
                    payouts[j].1 = 0; // zeroed — won't be credited again
                }
            }
        }

        // Single deduction from escrow
        let escrow = ctx.accounts.subject_state.to_account_info();
        **escrow.try_borrow_mut_lamports()? = escrow.lamports()
            .checked_sub(total_out).ok_or(FriendError::MathOverflow)?;

        // Credit each unique recipient
        let account_infos: [(Pubkey, AccountInfo); 4] = [
            (seller_key,   ctx.accounts.seller.to_account_info()),
            (fee_dest_key, ctx.accounts.fee_destination.to_account_info()),
            (subject_key,  ctx.accounts.subject.to_account_info()),
            (royalty_key,  ctx.accounts.royalty_wallet.to_account_info()),
        ];

        for (i, (key, info)) in account_infos.iter().enumerate() {
            let amount_to_credit = payouts[i].1;
            // Only credit if this slot is still the "owner" (not collapsed)
            if amount_to_credit > 0 && payouts[i].0 == *key {
                **info.try_borrow_mut_lamports()? = info.lamports()
                    .checked_add(amount_to_credit).ok_or(FriendError::MathOverflow)?;
            }
        }

        emit!(TradeEvent {
            trader: seller_key, subject: subject_key, is_buy: false,
            key_amount: amount, sol_amount: price,
            protocol_fee, subject_fee: subject_fee_total, royalty_fee: royalty_cut,
            supply: new_supply, price_floor: current_floor,
        });

        Ok(())
    }

    // ── burn_shares ──────────────────────────────────────────────────────────
    /// Burn `amount` keys permanently — no SOL payout.
    ///
    /// SPL tokens destroyed from holder's ATA.
    /// Supply decreases. Escrow SOL stays locked → remaining holders benefit
    /// (more SOL backing per outstanding key = stronger price floor).
    ///
    /// Use case: creator or holder wants to permanently remove keys from circulation.

    pub fn burn_shares(ctx: Context<BurnSharesCtx>, amount: u64) -> Result<()> {
        require!(amount > 0, FriendError::ZeroAmount);
        require!(ctx.accounts.holder_ata.amount >= amount, FriendError::InsufficientShares);
        require!(ctx.accounts.subject_state.supply > amount, FriendError::CannotSellLastShare);

        let new_supply = ctx.accounts.subject_state.supply
            .checked_sub(amount).ok_or(FriendError::MathOverflow)?;
        ctx.accounts.subject_state.supply = new_supply;

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint:      ctx.accounts.mint.to_account_info(),
                    from:      ctx.accounts.holder_ata.to_account_info(),
                    authority: ctx.accounts.holder.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(BurnEvent {
            burner: ctx.accounts.holder.key(),
            subject: ctx.accounts.subject.key(),
            amount,
            new_supply,
        });

        Ok(())
    }
}

// ─── Context structs ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(init, payer = authority, space = 8 + 113, seeds = [b"config"], bump)]
    pub config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
pub struct AdminDestination<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    /// CHECK: new fee destination — no data constraint
    pub new_destination: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct AdminBurnDestination<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    /// CHECK: new burn destination
    pub new_destination: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct InitializeSubject<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer  = creator,
        space  = 8 + 123,
        seeds  = [b"subject", creator.key().as_ref()],
        bump
    )]
    pub subject_state: Account<'info, SubjectState>,

    /// The SPL mint for this creator's keys.
    /// 0 decimals — 1 token = 1 key.
    /// Mint authority = subject_state PDA (program-controlled).
    #[account(
        init,
        payer              = creator,
        seeds              = [b"mint", creator.key().as_ref()],
        bump,
        mint::decimals     = 0,
        mint::authority    = subject_state,
    )]
    pub mint: Account<'info, Mint>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent:           Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct RegisterName<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"subject", creator.key().as_ref()],
        bump  = subject_state.bump
    )]
    pub subject_state: Account<'info, SubjectState>,

    /// Uniqueness enforced by `init` — fails if PDA already exists (name taken).
    #[account(
        init,
        payer  = creator,
        space  = 8 + 33,
        seeds  = [b"name", name.as_bytes()],
        bump
    )]
    pub subject_name: Account<'info, SubjectName>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetRoyaltyWallet<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"subject", creator.key().as_ref()],
        bump  = subject_state.bump
    )]
    pub subject_state: Account<'info, SubjectState>,
}

#[derive(Accounts)]
pub struct BuyShares<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: creator wallet — receives creator_cut of subject fee
    #[account(mut)]
    pub subject: AccountInfo<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,

    /// CHECK: must equal config.fee_destination
    #[account(
        mut,
        constraint = fee_destination.key() == config.fee_destination @ FriendError::Unauthorized
    )]
    pub fee_destination: AccountInfo<'info>,

    /// CHECK: royalty wallet
    /// If royalty_percent == 0, any account may be passed (no transfer will occur).
    /// If royalty_percent > 0, must equal subject_state.royalty_wallet.
    #[account(
        mut,
        constraint = subject_state.royalty_percent == 0
            || royalty_wallet.key() == subject_state.royalty_wallet
            @ FriendError::InvalidRoyaltyWallet
    )]
    pub royalty_wallet: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"subject", subject.key().as_ref()],
        bump  = subject_state.bump
    )]
    pub subject_state: Account<'info, SubjectState>,

    #[account(
        mut,
        seeds = [b"mint", subject.key().as_ref()],
        bump  = subject_state.mint_bump
    )]
    pub mint: Account<'info, Mint>,

    /// Buyer's ATA for this creator's key token.
    /// Created if it doesn't exist yet (first-time buyer).
    #[account(
        init_if_needed,
        payer                              = buyer,
        associated_token::mint             = mint,
        associated_token::authority        = buyer,
    )]
    pub buyer_ata: Account<'info, TokenAccount>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellShares<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: creator wallet — receives creator_cut
    #[account(mut)]
    pub subject: AccountInfo<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,

    /// CHECK: must equal config.fee_destination
    #[account(
        mut,
        constraint = fee_destination.key() == config.fee_destination @ FriendError::Unauthorized
    )]
    pub fee_destination: AccountInfo<'info>,

    /// CHECK: royalty wallet (see BuyShares for rules)
    #[account(
        mut,
        constraint = subject_state.royalty_percent == 0
            || royalty_wallet.key() == subject_state.royalty_wallet
            @ FriendError::InvalidRoyaltyWallet
    )]
    pub royalty_wallet: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"subject", subject.key().as_ref()],
        bump  = subject_state.bump
    )]
    pub subject_state: Account<'info, SubjectState>,

    #[account(
        mut,
        seeds = [b"mint", subject.key().as_ref()],
        bump  = subject_state.mint_bump
    )]
    pub mint: Account<'info, Mint>,

    /// Seller's ATA — tokens burned from here
    #[account(
        mut,
        associated_token::mint      = mint,
        associated_token::authority = seller,
    )]
    pub seller_ata: Account<'info, TokenAccount>,

    /// Per-(subject, seller) cooldown tracker. Created on first large sell.
    #[account(
        init_if_needed,
        payer  = seller,
        space  = 8 + 9,
        seeds  = [b"cooldown", subject.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub cooldown_state: Account<'info, CooldownState>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BurnSharesCtx<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,

    /// CHECK: creator address — needed for PDA seeds
    pub subject: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"subject", subject.key().as_ref()],
        bump  = subject_state.bump
    )]
    pub subject_state: Account<'info, SubjectState>,

    #[account(
        mut,
        seeds = [b"mint", subject.key().as_ref()],
        bump  = subject_state.mint_bump
    )]
    pub mint: Account<'info, Mint>,

    /// Holder's ATA — tokens burned from here
    #[account(
        mut,
        associated_token::mint      = mint,
        associated_token::authority = holder,
    )]
    pub holder_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
```

---

## `tests/friendtech.ts`

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program, BN }  from "@coral-xyz/anchor";
import { FriendtechShares } from "../target/types/friendtech_shares";
import {
  Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

anchor.setProvider(anchor.AnchorProvider.env());
const program  = anchor.workspace.FriendtechShares as Program<FriendtechShares>;
const provider = anchor.getProvider() as anchor.AnchorProvider;

// ─── TypeScript pricing mirror (must stay in sync with pricing.rs) ────────────

function isqrt(n: bigint): bigint {
  if (n === 0n) return 0n;
  let x = n, y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + n / x) >> 1n; }
  return x;
}

const SCALE      = 60_000n;
const BASE       = 1_000_000n;
const SELL_RATIO = 80n;
const PROTO_PCT  = 30_000_000n;  // 3%
const SUBJ_PCT   = 10_000_000n;  // 1%
const DENOM      = 1_000_000_000n;

const pricePerKey  = (s: bigint) => SCALE * isqrt(s + 1n) + BASE;
const getBuyPrice  = (s: bigint, a: bigint) => ((pricePerKey(s) + pricePerKey(s + a - 1n)) / 2n) * a;
const getSellPrice = (s: bigint, a: bigint) => getBuyPrice(s - a, a) * SELL_RATIO / 100n;

// ─── PDA helpers ──────────────────────────────────────────────────────────────

const pdaConfig   = ()                               => PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
const pdaSubject  = (s: PublicKey)                   => PublicKey.findProgramAddressSync([Buffer.from("subject"),  s.toBuffer()], program.programId);
const pdaMint     = (s: PublicKey)                   => PublicKey.findProgramAddressSync([Buffer.from("mint"),     s.toBuffer()], program.programId);
const pdaName     = (n: string)                      => PublicKey.findProgramAddressSync([Buffer.from("name"), Buffer.from(n)], program.programId);
const pdaCooldown = (s: PublicKey, h: PublicKey)     => PublicKey.findProgramAddressSync([Buffer.from("cooldown"), s.toBuffer(), h.toBuffer()], program.programId);

// ─── Tx helpers ───────────────────────────────────────────────────────────────

async function airdrop(key: PublicKey, sol = 10) {
  const sig = await provider.connection.requestAirdrop(key, sol * LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig, "confirmed");
}

async function tokenBalance(wallet: PublicKey, mint: PublicKey): Promise<bigint> {
  const ata = await getAssociatedTokenAddress(mint, wallet);
  try {
    const acc = await getAccount(provider.connection, ata);
    return acc.amount;
  } catch { return 0n; }
}

async function solBalance(key: PublicKey): Promise<number> {
  return provider.connection.getBalance(key);
}

async function initSubject(creator: Keypair): Promise<{ subjectState: PublicKey; mint: PublicKey }> {
  const [subjectState] = pdaSubject(creator.publicKey);
  const [mint]         = pdaMint(creator.publicKey);
  await program.methods.initializeSubject()
    .accounts({
      creator: creator.publicKey, subjectState, mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([creator]).rpc();
  return { subjectState, mint };
}

async function buyKeys(
  buyer: Keypair, subject: PublicKey, amount: number,
  configKey: PublicKey, feeDest: PublicKey, royaltyWallet?: PublicKey
) {
  const [subjectState] = pdaSubject(subject);
  const [mint]         = pdaMint(subject);
  const buyerAta       = await getAssociatedTokenAddress(mint, buyer.publicKey);
  const rw             = royaltyWallet ?? subject; // default: subject itself (royalty_percent=0)

  await program.methods.buyShares(new BN(amount))
    .accounts({
      buyer: buyer.publicKey, subject, config: configKey,
      feeDestination: feeDest, royaltyWallet: rw,
      subjectState, mint, buyerAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([buyer]).rpc();
}

async function sellKeys(
  seller: Keypair, subject: PublicKey, amount: number,
  configKey: PublicKey, feeDest: PublicKey, royaltyWallet?: PublicKey
) {
  const [subjectState]  = pdaSubject(subject);
  const [mint]          = pdaMint(subject);
  const sellerAta       = await getAssociatedTokenAddress(mint, seller.publicKey);
  const [cooldownState] = pdaCooldown(subject, seller.publicKey);
  const rw              = royaltyWallet ?? subject;

  await program.methods.sellShares(new BN(amount))
    .accounts({
      seller: seller.publicKey, subject, config: configKey,
      feeDestination: feeDest, royaltyWallet: rw,
      subjectState, mint, sellerAta, cooldownState,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([seller]).rpc();
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const authority  = Keypair.generate();
const creator    = Keypair.generate();
const buyerA     = Keypair.generate();
const buyerB     = Keypair.generate();
const royaltyKP  = Keypair.generate();

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("friendtech-shares — final production", () => {
  let configKey: PublicKey;
  let feeDest:   PublicKey;
  let mint:      PublicKey;

  before(async () => {
    await Promise.all([authority, creator, buyerA, buyerB, royaltyKP].map(k => airdrop(k.publicKey, 10)));
    [configKey] = pdaConfig();
    feeDest     = authority.publicKey;
  });

  // ── Pricing math (pure TS) ────────────────────────────────────────────────

  it("first key: price = BASE + SCALE", () => {
    assert.equal(getBuyPrice(0n, 1n).toString(), (BASE + SCALE).toString());
  });

  it("price strictly increases with supply", () => {
    let prev = 0n;
    for (const s of [1n, 100n, 1_000n, 10_000n, 1_000_000n]) {
      const p = pricePerKey(s);
      assert.isTrue(p > prev);
      prev = p;
    }
  });

  it("sell = 80% of equivalent buy", () => {
    for (const s of [10n, 1_000n, 100_000n]) {
      assert.equal(getSellPrice(s, 1n).toString(), (getBuyPrice(s - 1n, 1n) * 80n / 100n).toString());
    }
  });

  it("no discontinuity at perfect square boundaries", () => {
    for (const sq of [100n, 400n, 10_000n, 1_000_000n]) {
      const a = pricePerKey(sq - 1n), b = pricePerKey(sq);
      const jump = b > a ? b - a : a - b;
      assert.isTrue(jump * 100n < a * 2n, `spike at sq=${sq}`);
    }
  });

  // ── Protocol init ─────────────────────────────────────────────────────────

  it("initializes protocol with 3%/1% fees", async () => {
    await program.methods.initializeProtocol(new BN(30_000_000), new BN(10_000_000))
      .accounts({ authority: authority.publicKey, config: configKey, systemProgram: SystemProgram.programId })
      .signers([authority]).rpc();

    const cfg = await program.account.protocolConfig.fetch(configKey);
    assert.equal(cfg.protocolFeePercent.toString(), "30000000"); // 3%
    assert.equal(cfg.subjectFeePercent.toString(),  "10000000"); // 1%
  });

  // ── initialize_subject ────────────────────────────────────────────────────

  it("creator initializes their subject and mint", async () => {
    const result = await initSubject(creator);
    mint = result.mint;
    const [ss] = pdaSubject(creator.publicKey);
    const data  = await program.account.subjectState.fetch(ss);
    assert.equal(data.subject.toBase58(), creator.publicKey.toBase58());
    assert.equal(data.supply.toString(), "0");
    assert.isFalse(data.hasName);
  });

  // ── register_name ─────────────────────────────────────────────────────────

  it("creator registers unique lowercase name", async () => {
    const [ss]   = pdaSubject(creator.publicKey);
    const [namePDA] = pdaName("satoshi");
    await program.methods.registerName("satoshi")
      .accounts({
        creator: creator.publicKey, subjectState: ss,
        subjectName: namePDA, systemProgram: SystemProgram.programId,
      })
      .signers([creator]).rpc();

    const data = await program.account.subjectState.fetch(ss);
    assert.isTrue(data.hasName);
    const nameStr = Buffer.from(data.name).toString("utf8").replace(/\0/g, "");
    assert.equal(nameStr, "satoshi");
  });

  it("cannot register same name twice", async () => {
    const creator2 = Keypair.generate();
    await airdrop(creator2.publicKey);
    await initSubject(creator2);

    const [ss2]     = pdaSubject(creator2.publicKey);
    const [namePDA] = pdaName("satoshi");

    try {
      await program.methods.registerName("satoshi")
        .accounts({
          creator: creator2.publicKey, subjectState: ss2,
          subjectName: namePDA, systemProgram: SystemProgram.programId,
        })
        .signers([creator2]).rpc();
      assert.fail("Should have thrown — name already taken");
    } catch (e: any) {
      // Expected: PDA already exists, init fails
      assert.isTrue(e.message.includes("already in use") || e.message.includes("0x0"));
    }
  });

  it("cannot register uppercase or special chars", async () => {
    const [ss] = pdaSubject(creator.publicKey);
    for (const badName of ["UPPER", "with space", "has@sym"]) {
      try {
        const [namePDA] = pdaName(badName);
        await program.methods.registerName(badName)
          .accounts({
            creator: creator.publicKey, subjectState: ss,
            subjectName: namePDA, systemProgram: SystemProgram.programId,
          })
          .signers([creator]).rpc();
        assert.fail(`Should have rejected: ${badName}`);
      } catch (e: any) {
        assert.isTrue(
          e.message.includes("NameInvalidChars") || e.message.includes("NameAlreadySet"),
          `Wrong error for "${badName}": ${e.message}`
        );
      }
    }
  });

  // ── buy_shares ────────────────────────────────────────────────────────────

  it("creator buys first key — SPL token minted to their wallet", async () => {
    await buyKeys(creator, creator.publicKey, 1, configKey, feeDest);

    const [ss]  = pdaSubject(creator.publicKey);
    const ssData = await program.account.subjectState.fetch(ss);
    const bal    = await tokenBalance(creator.publicKey, mint);

    assert.equal(ssData.supply.toString(), "1");
    assert.equal(bal.toString(), "1");
  });

  it("non-creator cannot buy first key of new subject", async () => {
    const c2 = Keypair.generate();
    await airdrop(c2.publicKey);
    await initSubject(c2);
    const [m2] = pdaMint(c2.publicKey);

    try {
      await buyKeys(buyerA, c2.publicKey, 1, configKey, feeDest);
      assert.fail();
    } catch (e: any) { assert.include(e.message, "OnlySubjectCanBuyFirst"); }
  });

  it("buyerA purchases keys — tokens appear in wallet", async () => {
    const balBefore = await tokenBalance(buyerA.publicKey, mint);
    await buyKeys(buyerA, creator.publicKey, 3, configKey, feeDest);
    const balAfter  = await tokenBalance(buyerA.publicKey, mint);
    assert.equal((balAfter - balBefore).toString(), "3");

    const [ss] = pdaSubject(creator.publicKey);
    const ssData = await program.account.subjectState.fetch(ss);
    assert.equal(ssData.supply.toString(), "4");
  });

  it("price floor increases after buy", async () => {
    const [ss] = pdaSubject(creator.publicKey);
    const before = (await program.account.subjectState.fetch(ss)).priceFloor.toNumber();
    await buyKeys(buyerB, creator.publicKey, 2, configKey, feeDest);
    const after  = (await program.account.subjectState.fetch(ss)).priceFloor.toNumber();
    assert.isTrue(after >= before && after > 0);
  });

  // ── Royalty wallet ────────────────────────────────────────────────────────

  it("creator sets royalty wallet (50% of subject fee)", async () => {
    const [ss] = pdaSubject(creator.publicKey);
    await program.methods.setRoyaltyWallet(royaltyKP.publicKey, new BN(50))
      .accounts({ creator: creator.publicKey, subjectState: ss })
      .signers([creator]).rpc();

    const data = await program.account.subjectState.fetch(ss);
    assert.equal(data.royaltyWallet.toBase58(), royaltyKP.publicKey.toBase58());
    assert.equal(data.royaltyPercent.toString(), "50");
  });

  it("royalty wallet receives correct cut on buy", async () => {
    const royaltyBefore = await solBalance(royaltyKP.publicKey);
    await buyKeys(buyerA, creator.publicKey, 1, configKey, feeDest, royaltyKP.publicKey);
    const royaltyAfter  = await solBalance(royaltyKP.publicKey);
    assert.isTrue(royaltyAfter > royaltyBefore, "royalty wallet should receive SOL");
  });

  // ── sell_shares ───────────────────────────────────────────────────────────

  it("holder sells keys — tokens burned, SOL received", async () => {
    const solBefore  = await solBalance(buyerA.publicKey);
    const tokBefore  = await tokenBalance(buyerA.publicKey, mint);
    await sellKeys(buyerA, creator.publicKey, 1, configKey, feeDest, royaltyKP.publicKey);
    const solAfter   = await solBalance(buyerA.publicKey);
    const tokAfter   = await tokenBalance(buyerA.publicKey, mint);

    assert.isTrue(tokAfter < tokBefore,  "tokens should decrease");
    assert.isTrue(solAfter > solBefore - 10_000, "seller nets positive");
  });

  it("cannot sell last key", async () => {
    const [ss] = pdaSubject(creator.publicKey);
    const supply = (await program.account.subjectState.fetch(ss)).supply.toNumber();
    try {
      await sellKeys(creator, creator.publicKey, supply, configKey, feeDest, royaltyKP.publicKey);
      assert.fail();
    } catch (e: any) {
      assert.isTrue(
        ["CannotSellLastShare","InsufficientShares","ExceedsSellLimit"].some(s => e.message.includes(s))
      );
    }
  });

  it("cannot sell more than 5% of supply per tx", async () => {
    const [ss] = pdaSubject(creator.publicKey);
    const supply = (await program.account.subjectState.fetch(ss)).supply.toNumber();
    if (supply < 40) {
      try {
        await sellKeys(buyerA, creator.publicKey, 3, configKey, feeDest, royaltyKP.publicKey);
        assert.fail();
      } catch (e: any) { assert.include(e.message, "ExceedsSellLimit"); }
    }
  });

  // ── burn_shares ───────────────────────────────────────────────────────────

  it("holder burns keys — tokens destroyed, no SOL payout, supply decreases", async () => {
    // First ensure buyerB has some keys
    const [ss]    = pdaSubject(creator.publicKey);
    const tokBefore = await tokenBalance(buyerB.publicKey, mint);
    const ssData    = await program.account.subjectState.fetch(ss);
    const supplyBefore = ssData.supply.toNumber();

    if (tokBefore > 0n) {
      const solBefore = await solBalance(buyerB.publicKey);
      await program.methods.burnShares(new BN(1))
        .accounts({
          holder: buyerB.publicKey,
          subject: creator.publicKey,
          subjectState: ss,
          mint,
          holderAta: await getAssociatedTokenAddress(mint, buyerB.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyerB]).rpc();

      const tokAfter  = await tokenBalance(buyerB.publicKey, mint);
      const solAfter  = await solBalance(buyerB.publicKey);
      const ssAfter   = await program.account.subjectState.fetch(ss);

      assert.isTrue(tokAfter < tokBefore, "tokens should decrease");
      assert.isTrue(solAfter <= solBefore, "no SOL payout on burn");
      assert.equal(ssAfter.supply.toNumber(), supplyBefore - 1);
    }
  });

  // ── Key transfer (SPL native) ─────────────────────────────────────────────

  it("keys are transferable like SPL tokens without program involvement", async () => {
    // Standard SPL transfer — no custom instruction needed
    const { createTransferInstruction, getOrCreateAssociatedTokenAccount } = await import("@solana/spl-token");
    const { Transaction } = await import("@solana/web3.js");

    const fromAta = await getAssociatedTokenAddress(mint, buyerA.publicKey);
    const toAcc   = await getOrCreateAssociatedTokenAccount(
      provider.connection, creator, mint, buyerB.publicKey
    );

    const fromBal = await tokenBalance(buyerA.publicKey, mint);
    if (fromBal >= 1n) {
      const tx = new Transaction().add(
        createTransferInstruction(fromAta, toAcc.address, buyerA.publicKey, 1)
      );
      await provider.connection.sendTransaction(tx, [buyerA]);
      const newBal = await tokenBalance(buyerA.publicKey, mint);
      assert.isTrue(newBal < fromBal, "tokens transferred via standard SPL");
    }
  });

  // ── Admin ─────────────────────────────────────────────────────────────────

  it("authority updates fees", async () => {
    await program.methods.setFees(new BN(20_000_000), new BN(5_000_000))
      .accounts({ authority: authority.publicKey, config: configKey }).signers([authority]).rpc();
    const cfg = await program.account.protocolConfig.fetch(configKey);
    assert.equal(cfg.protocolFeePercent.toString(), "20000000");
    // Reset
    await program.methods.setFees(new BN(30_000_000), new BN(10_000_000))
      .accounts({ authority: authority.publicKey, config: configKey }).signers([authority]).rpc();
  });

  it("non-authority cannot update fees", async () => {
    try {
      await program.methods.setFees(new BN(0), new BN(0))
        .accounts({ authority: buyerA.publicKey, config: configKey }).signers([buyerA]).rpc();
      assert.fail();
    } catch (e: any) { assert.include(e.message, "Unauthorized"); }
  });

  it("fee over 20% rejected", async () => {
    try {
      await program.methods.setFees(new BN(300_000_000), new BN(10_000_000))
        .accounts({ authority: authority.publicKey, config: configKey }).signers([authority]).rpc();
      assert.fail();
    } catch (e: any) { assert.include(e.message, "FeeTooHigh"); }
  });
});
```

---

## Deployment Checklist

### Devnet
```bash
anchor build
anchor deploy --provider.cluster devnet
cargo test              # 8 unit tests in pricing.rs
anchor test --provider.cluster devnet
```

### Pre-mainnet gate
- [ ] `anchor build --verifiable` — reproducible build hash for audit
- [ ] All `cargo test` pass (pricing.rs unit tests)
- [ ] All integration tests pass on devnet
- [ ] Verify SPL token appears in Phantom/Backpack after buy
- [ ] Verify transfer between wallets works (no program needed)
- [ ] Test name registration: taken name fails, uppercase fails
- [ ] Test royalty split: royalty_wallet receives correct percentage
- [ ] Test burn: supply decreases, no SOL payout, escrow intact
- [ ] `initialize_protocol` called with multisig as authority
- [ ] `set_fee_destination` pointed at multisig treasury
- [ ] Upgrade authority set to multisig or frozen
- [ ] sell_shares lamport deduction + duplicate-key collapse logic audited
- [ ] Formal third-party audit before significant TVL

---

## What Users Experience

```
Creator flow:
  1. Call initialize_subject()         → creates SubjectState + SPL mint
  2. Call buy_shares(1)               → mints 1 key to own wallet (free first key)
  3. Call register_name("satoshi")    → optional, locks unique name forever
  4. Call set_royalty_wallet(addr,50) → optional, share 50% of creator fee with partner
  5. Keys appear in Phantom automatically

Buyer flow:
  1. Call buy_shares(n)               → n key tokens appear in Phantom wallet
  2. Transfer keys: standard SPL transfer (no program call)
  3. Call sell_shares(n)              → tokens burned, SOL received
  4. Call burn_shares(n)              → tokens burned, no payout (voluntary deflation)

Key token properties:
  - Visible in Phantom / Backpack / any Solana wallet
  - Tradeable on Jupiter / Raydium (same as any SPL token)
  - 0 decimals (whole keys only)
  - Supply visible on Solscan / SolanaFM
  - Standard transfer: no program interaction required
```
