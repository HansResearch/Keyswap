use anchor_lang::prelude::*;
use crate::error::FriendError;

/// Bonding curve price for `amount` shares starting at `supply`.
/// Same summation-of-squares formula as the FriendTech Ethereum contract.
/// Returns lamports (1 SOL = 1_000_000_000 lamports).
pub fn get_price(supply: u64, amount: u64) -> Result<u64> {
    let s = supply as u128;
    let a = amount as u128;

    let sum1: u128 = if s == 0 {
        0
    } else {
        (s - 1)
            .checked_mul(s)
            .ok_or(error!(FriendError::MathOverflow))?
            .checked_mul(2u128.checked_mul(s - 1).ok_or(error!(FriendError::MathOverflow))?.checked_add(1).ok_or(error!(FriendError::MathOverflow))?)
            .ok_or(error!(FriendError::MathOverflow))?
            / 6
    };

    let sum2: u128 = if s == 0 && a == 1 {
        0
    } else {
        let n = s
            .checked_sub(1)
            .ok_or(error!(FriendError::MathOverflow))?
            .checked_add(a)
            .ok_or(error!(FriendError::MathOverflow))?;
        let two_n_plus_1 = 2u128
            .checked_mul(n)
            .ok_or(error!(FriendError::MathOverflow))?
            .checked_add(1)
            .ok_or(error!(FriendError::MathOverflow))?;
        n.checked_mul(s.checked_add(a).ok_or(error!(FriendError::MathOverflow))?)
            .ok_or(error!(FriendError::MathOverflow))?
            .checked_mul(two_n_plus_1)
            .ok_or(error!(FriendError::MathOverflow))?
            / 6
    };

    let summation = sum2
        .checked_sub(sum1)
        .ok_or(error!(FriendError::MathOverflow))?;

    let price = summation
        .checked_mul(1_000_000_000)
        .ok_or(error!(FriendError::MathOverflow))?
        / 16_000;

    Ok(price as u64)
}

pub fn get_buy_price(supply: u64, amount: u64) -> Result<u64> {
    get_price(supply, amount)
}

pub fn get_sell_price(supply: u64, amount: u64) -> Result<u64> {
    let sell_supply = supply
        .checked_sub(amount)
        .ok_or(error!(FriendError::MathOverflow))?;
    get_price(sell_supply, amount)
}
