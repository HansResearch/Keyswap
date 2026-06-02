use anchor_lang::prelude::*;
use crate::state::ProtocolConfig;
use crate::error::FriendError;

#[derive(Accounts)]
pub struct SetFees<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.authority == authority.key() @ FriendError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,
}

pub fn handler(
    ctx: Context<SetFees>,
    protocol_fee_percent: u64,
    subject_fee_percent: u64,
) -> Result<()> {
    require!(protocol_fee_percent <= 200_000_000, FriendError::FeeTooHigh);
    require!(subject_fee_percent <= 200_000_000, FriendError::FeeTooHigh);

    let config = &mut ctx.accounts.config;
    config.protocol_fee_percent = protocol_fee_percent;
    config.subject_fee_percent = subject_fee_percent;
    Ok(())
}
