use anchor_lang::prelude::*;
use crate::state::ProtocolConfig;
use crate::error::FriendError;

#[derive(Accounts)]
pub struct SetFeeDestination<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.authority == authority.key() @ FriendError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// CHECK: just storing the pubkey as fee destination, no data access
    pub fee_destination: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<SetFeeDestination>) -> Result<()> {
    ctx.accounts.config.fee_destination = ctx.accounts.fee_destination.key();
    Ok(())
}
