pub mod error;
pub mod instructions;
pub mod pricing;
pub mod state;

use anchor_lang::prelude::*;

// Wildcard re-exports bring both the visible structs AND the macro-generated
// __client_accounts_* types to crate root, which is required by #[program].
pub use instructions::buy_shares::*;
pub use instructions::initialize_protocol::*;
pub use instructions::sell_shares::*;
pub use instructions::set_fee_destination::*;
pub use instructions::set_fees::*;
pub use state::{BalanceState, ProtocolConfig, SubjectState};

declare_id!("EKHiWwKJvwP5EWDHy7oZfmgqwaUvxCQ7WP65ZKymQcX5");

#[program]
pub mod friendtech_shares {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        protocol_fee_percent: u64,
        subject_fee_percent: u64,
    ) -> Result<()> {
        instructions::initialize_protocol::handler(ctx, protocol_fee_percent, subject_fee_percent)
    }

    pub fn set_fees(
        ctx: Context<SetFees>,
        protocol_fee_percent: u64,
        subject_fee_percent: u64,
    ) -> Result<()> {
        instructions::set_fees::handler(ctx, protocol_fee_percent, subject_fee_percent)
    }

    pub fn set_fee_destination(ctx: Context<SetFeeDestination>) -> Result<()> {
        instructions::set_fee_destination::handler(ctx)
    }

    pub fn buy_shares(ctx: Context<BuyShares>, amount: u64) -> Result<()> {
        instructions::buy_shares::handler(ctx, amount)
    }

    pub fn sell_shares(ctx: Context<SellShares>, amount: u64) -> Result<()> {
        instructions::sell_shares::handler(ctx, amount)
    }
}
