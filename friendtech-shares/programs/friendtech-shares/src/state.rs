use anchor_lang::prelude::*;

#[account]
pub struct ProtocolConfig {
    pub authority: Pubkey,           // 32
    pub fee_destination: Pubkey,     // 32
    pub protocol_fee_percent: u64,   // 8
    pub subject_fee_percent: u64,    // 8
    pub bump: u8,                    // 1
}

impl ProtocolConfig {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1;
}

#[account]
pub struct SubjectState {
    pub subject: Pubkey,    // 32
    pub supply: u64,        // 8
    pub bump: u8,           // 1
}

impl SubjectState {
    pub const LEN: usize = 8 + 32 + 8 + 1;
}

#[account]
pub struct BalanceState {
    pub subject: Pubkey,    // 32
    pub holder: Pubkey,     // 32
    pub balance: u64,       // 8
    pub bump: u8,           // 1
}

impl BalanceState {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1;
}
