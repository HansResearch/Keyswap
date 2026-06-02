use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use crate::state::{ProtocolConfig, SubjectState, BalanceState};
use crate::error::FriendError;
use crate::pricing::get_buy_price;

#[event]
pub struct TradeEvent {
    pub trader: Pubkey,
    pub subject: Pubkey,
    pub is_buy: bool,
    pub share_amount: u64,
    pub sol_amount: u64,
    pub protocol_fee: u64,
    pub subject_fee: u64,
    pub supply: u64,
}

#[derive(Accounts)]
pub struct BuyShares<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: just receiving fees, no data validation needed
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
        init_if_needed,
        payer = buyer,
        space = SubjectState::LEN,
        seeds = [b"subject", subject.key().as_ref()],
        bump
    )]
    pub subject_state: Account<'info, SubjectState>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = BalanceState::LEN,
        seeds = [b"balance", subject.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub balance_state: Account<'info, BalanceState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<BuyShares>, amount: u64) -> Result<()> {
    let supply = ctx.accounts.subject_state.supply;
    let buyer_key = ctx.accounts.buyer.key();
    let subject_key = ctx.accounts.subject.key();

    require!(
        supply > 0 || subject_key == buyer_key,
        FriendError::OnlySubjectCanBuyFirst
    );

    let price = get_buy_price(supply, amount)?;
    let config = &ctx.accounts.config;

    let protocol_fee = price
        .checked_mul(config.protocol_fee_percent)
        .ok_or(error!(FriendError::MathOverflow))?
        / 1_000_000_000;

    let subject_fee = price
        .checked_mul(config.subject_fee_percent)
        .ok_or(error!(FriendError::MathOverflow))?
        / 1_000_000_000;

    let total_cost = price
        .checked_add(protocol_fee)
        .ok_or(error!(FriendError::MathOverflow))?
        .checked_add(subject_fee)
        .ok_or(error!(FriendError::MathOverflow))?;

    require!(
        ctx.accounts.buyer.lamports() >= total_cost,
        FriendError::InsufficientPayment
    );

    // Update state before transfers (checks-effects-interactions)
    ctx.accounts.balance_state.subject = subject_key;
    ctx.accounts.balance_state.holder = buyer_key;
    ctx.accounts.balance_state.bump = ctx.bumps.balance_state;
    ctx.accounts.balance_state.balance = ctx.accounts.balance_state.balance
        .checked_add(amount)
        .ok_or(error!(FriendError::MathOverflow))?;
    ctx.accounts.subject_state.subject = subject_key;
    ctx.accounts.subject_state.bump = ctx.bumps.subject_state;
    ctx.accounts.subject_state.supply = supply
        .checked_add(amount)
        .ok_or(error!(FriendError::MathOverflow))?;

    let buyer_info = ctx.accounts.buyer.to_account_info();
    let system_info = ctx.accounts.system_program.to_account_info();

    // Protocol fee: buyer → fee_destination
    invoke(
        &system_instruction::transfer(&buyer_key, &config.fee_destination, protocol_fee),
        &[buyer_info.clone(), ctx.accounts.fee_destination.to_account_info(), system_info.clone()],
    )?;

    // Subject fee: buyer → subject
    invoke(
        &system_instruction::transfer(&buyer_key, &subject_key, subject_fee),
        &[buyer_info.clone(), ctx.accounts.subject.to_account_info(), system_info.clone()],
    )?;

    // Remaining price: buyer → subject_state PDA (escrow backing sell liquidity)
    invoke(
        &system_instruction::transfer(&buyer_key, &ctx.accounts.subject_state.key(), price),
        &[buyer_info, ctx.accounts.subject_state.to_account_info(), system_info],
    )?;

    emit!(TradeEvent {
        trader: buyer_key,
        subject: subject_key,
        is_buy: true,
        share_amount: amount,
        sol_amount: price,
        protocol_fee,
        subject_fee,
        supply: ctx.accounts.subject_state.supply,
    });

    Ok(())
}
