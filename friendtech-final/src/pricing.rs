use anchor_lang::prelude::*;
use crate::errors::FriendError;

// Hyperbolic bonding curve: price(s) = K * (s + 1) / (MAX_SUPPLY - s)
//
// K = 100 SOL in lamports  →  first key costs ~0.01 SOL (~$1.50 at $150/SOL)
// MAX_SUPPLY = 10,000       →  absolute hard cap per key
// At 4,500 holders price ≈ $13,600/key → MC ≈ $64M (with V_DISPLAY=175 on frontend)
//
// Must stay in sync with lovable-frontend/src/lib/pricing.ts

pub const MAX_SUPPLY:            u64 = 10_000;
pub const K:                     u64 = 100_000_000_000; // 100 SOL in lamports
pub const CREATOR_FIRST_BUY_MIN: u64 = 3;               // must buy ≥3 keys at launch
pub const CREATOR_FIRST_BUY_MAX: u64 = 50;              // may buy ≤50 keys at launch

pub const SELL_RATIO_BASE:  u64 = 9_500; // 95% in basis points
pub const SELL_RATIO_FLOOR: u64 = 8_000; // 80% floor
pub const SELL_SLOPE:       u64 = 50;    // 0.5% ratio drop per 1% of supply sold

/// Instantaneous price for 1 key when current supply is `supply`.
/// price = K * (supply + 1) / (MAX_SUPPLY - supply)
pub fn price_per_key(supply: u64) -> Result<u64> {
    if supply >= MAX_SUPPLY {
        return Err(error!(FriendError::MaxSupplyReached));
    }
    let remaining  = MAX_SUPPLY - supply; // always ≥ 1
    let numerator  = (K as u128) * (supply as u128 + 1);
    let price      = numerator / remaining as u128;
    if price > u64::MAX as u128 {
        return Err(error!(FriendError::MathOverflow));
    }
    Ok(price as u64)
}

/// Total buy cost for `amount` keys starting at `supply` (trapezoidal rule).
pub fn get_buy_price(supply: u64, amount: u64) -> Result<u64> {
    require!(amount > 0, FriendError::ZeroAmount);
    let new_supply = supply.checked_add(amount)
        .ok_or(error!(FriendError::MathOverflow))?;
    if new_supply > MAX_SUPPLY {
        return Err(error!(FriendError::MaxSupplyReached));
    }
    let p_start = price_per_key(supply)? as u128;
    let p_end   = price_per_key(new_supply - 1)? as u128;
    let total   = (p_start + p_end) / 2 * amount as u128;
    if total > u64::MAX as u128 {
        return Err(error!(FriendError::MathOverflow));
    }
    Ok(total as u64)
}

/// Progressive sell-slippage ratio in basis points (10_000 = 100%).
/// sell_pct = amount / supply
/// ratio    = max(SELL_RATIO_FLOOR, SELL_RATIO_BASE - sell_pct_bps * SELL_SLOPE / 100)
pub fn get_sell_ratio_bps(supply: u64, amount: u64) -> u64 {
    if supply == 0 { return SELL_RATIO_FLOOR; }
    let sell_bps = amount.saturating_mul(10_000) / supply;
    let penalty  = sell_bps.saturating_mul(SELL_SLOPE) / 100;
    SELL_RATIO_BASE.saturating_sub(penalty).max(SELL_RATIO_FLOOR)
}

/// Sell price with progressive slippage.
pub fn get_sell_price(supply: u64, amount: u64) -> Result<u64> {
    require!(amount > 0, FriendError::ZeroAmount);
    require!(supply > amount, FriendError::CannotSellLastShare);
    let raw   = get_buy_price(supply.checked_sub(amount)
                    .ok_or(error!(FriendError::MathOverflow))?, amount)?;
    let ratio = get_sell_ratio_bps(supply, amount);
    let sell  = (raw as u128) * ratio as u128 / 10_000;
    Ok(sell as u64)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_key_price() {
        // price_per_key(0) = K * 1 / MAX_SUPPLY = 100 SOL / 10_000 = 0.01 SOL
        let expected = K / MAX_SUPPLY;
        assert_eq!(price_per_key(0).unwrap(), expected);
    }

    #[test]
    fn price_strictly_increases() {
        let mut prev = 0u64;
        for s in [0u64, 1, 10, 100, 500, 1_000, 5_000, 9_000, 9_999] {
            let p = price_per_key(s).unwrap();
            assert!(p > prev, "price not increasing at s={}", s);
            prev = p;
        }
    }

    #[test]
    fn max_supply_rejected() {
        assert!(price_per_key(MAX_SUPPLY).is_err());
        assert!(get_buy_price(MAX_SUPPLY - 1, 2).is_err());
    }

    #[test]
    fn buy_10_keys_from_zero() {
        // Should cost roughly 0.55 SOL (~$82 at $150/SOL)
        let cost = get_buy_price(0, 10).unwrap();
        // p_start = K/10000 = 10_000_000, p_end = K*10/9991 ≈ 100_090_080
        // total = (10_000_000 + 100_090_080) / 2 * 10 ≈ 550_450_400
        assert!(cost > 500_000_000 && cost < 600_000_000, "cost={}", cost);
    }

    #[test]
    fn sell_ratio_progressive() {
        // Small sell (1% of supply) → near 95%
        let ratio_small = get_sell_ratio_bps(1000, 10); // 1% → penalty 50bps → ratio 9450
        assert!(ratio_small >= 9_400, "small sell ratio={}", ratio_small);

        // Large sell (30% of supply) → at 80% floor
        let ratio_large = get_sell_ratio_bps(1000, 300); // 30% → penalty 1500 → ratio 8000
        assert_eq!(ratio_large, SELL_RATIO_FLOOR);

        // Selling 1 key at supply S must return less than buying 1 key at supply S-1
        let buy  = get_buy_price(9, 1).unwrap();  // cost to buy the 10th key
        let sell = get_sell_price(10, 1).unwrap(); // proceeds from selling 1 at supply=10
        assert!(sell < buy, "sell={} buy={}", sell, buy);
    }

    #[test]
    fn no_overflow_near_max_supply() {
        // Last buyable key (9999 → MAX_SUPPLY)
        let price = price_per_key(9_999).unwrap();
        assert!(price > 0);
        // Buy 1 key when supply = 9999 (fills to MAX_SUPPLY)
        let cost = get_buy_price(9_999, 1).unwrap();
        assert_eq!(cost, price); // single key trapezoidal = price itself
    }
}
