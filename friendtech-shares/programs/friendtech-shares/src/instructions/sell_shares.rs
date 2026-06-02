use anchor_lang::prelude::*;
use crate::state::{ProtocolConfig, SubjectState, BalanceState};
use crate::error::FriendError;
use crate::pricing::get_sell_price;
use crate::instructions::buy_shares::TradeEvent;

#[derive(Accounts)]
pub struct SellShares<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: receives subject fee
    #[account(mut)]
    pub subject: UncheckedAccount<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// CHECK: validated against config.fee_destination via constraint
    #[account(
        mut,
        constraint = fee_destination.key() == config.fee_destination @ FriendError::Unauthorized
    )]
    pub fee_destination: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"subject", subject.key().as_ref()],
        bump
    )]
    pub subject_state: Account<'info, SubjectState>,

    #[account(
        mut,
        seeds = [b"balance", subject.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub balance_state: Account<'info, BalanceState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SellShares>, amount: u64) -> Result<()> {
    let supply = ctx.accounts.subject_state.supply;

    require!(supply > amount, FriendError::CannotSellLastShare);
    require!(
        ctx.accounts.balance_state.balance >= amount,
        FriendError::InsufficientShares
    );

    let price = get_sell_price(supply, amount)?;
    let config = &ctx.accounts.config;

    let protocol_fee = price
        .checked_mul(config.protocol_fee_percent)
        .ok_or(error!(FriendError::MathOverflow))?
        / 1_000_000_000;

    let subject_fee = price
        .checked_mul(config.subject_fee_percent)
        .ok_or(error!(FriendError::MathOverflow))?
        / 1_000_000_000;

    let seller_payout = price
        .checked_sub(protocol_fee)
        .ok_or(error!(FriendError::MathOverflow))?
        .checked_sub(subject_fee)
        .ok_or(error!(FriendError::MathOverflow))?;

    // Update state before lamport transfers
    ctx.accounts.balance_state.balance = ctx.accounts.balance_state.balance
        .checked_sub(amount)
        .ok_or(error!(FriendError::MathOverflow))?;
    let new_supply = supply
        .checked_sub(amount)
        .ok_or(error!(FriendError::MathOverflow))?;
    ctx.accounts.subject_state.supply = new_supply;

    // Pay from subject_state PDA escrow using lamport manipulation
    // (PDA can't sign for system_program::transfer)
    **ctx.accounts.subject_state.to_account_info().try_borrow_mut_lamports()? -= seller_payout;
    **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += seller_payout;

    **ctx.accounts.subject_state.to_account_info().try_borrow_mut_lamports()? -= protocol_fee;
    **ctx.accounts.fee_destination.to_account_info().try_borrow_mut_lamports()? += protocol_fee;

    **ctx.accounts.subject_state.to_account_info().try_borrow_mut_lamports()? -= subject_fee;
    **ctx.accounts.subject.to_account_info().try_borrow_mut_lamports()? += subject_fee;

    emit!(TradeEvent {
        trader: ctx.accounts.seller.key(),
        subject: ctx.accounts.subject.key(),
        is_buy: false,
        share_amount: amount,
        sol_amount: price,
        protocol_fee,
        subject_fee,
        supply: new_supply,
    });

    Ok(())
}
