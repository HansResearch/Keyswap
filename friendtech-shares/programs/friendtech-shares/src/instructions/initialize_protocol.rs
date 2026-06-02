use anchor_lang::prelude::*;
use crate::state::ProtocolConfig;
use crate::error::FriendError;

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = ProtocolConfig::LEN,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeProtocol>,
    protocol_fee_percent: u64,
    subject_fee_percent: u64,
) -> Result<()> {
    require!(protocol_fee_percent <= 200_000_000, FriendError::FeeTooHigh);
    require!(subject_fee_percent <= 200_000_000, FriendError::FeeTooHigh);

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.fee_destination = ctx.accounts.authority.key();
    config.protocol_fee_percent = protocol_fee_percent;
    config.subject_fee_percent = subject_fee_percent;
    config.bump = ctx.bumps.config;
    Ok(())
}
