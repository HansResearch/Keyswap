use anchor_lang::prelude::*;

/// Global protocol config. One PDA, deployed once.
/// Seeds: [b"config"]
/// Layout is intentionally frozen — the account was initialized before the security rewrite
/// so field order must not change (bump must stay at offset 112).
#[account]
pub struct ProtocolConfig {
    pub authority:            Pubkey,  // 32
    pub fee_destination:      Pubkey,  // 32
    pub burn_destination:     Pubkey,  // 32 — unused; kept for layout compatibility
    pub protocol_fee_percent: u64,     // 8
    pub subject_fee_percent:  u64,     // 8
    pub bump:                 u8,      // 1
}
// space = 8 + 113 = 121

/// Pending fee change. Created by propose_fees, consumed by apply_fees.
/// Seeds: [b"fee_proposal"]
#[account]
pub struct FeeProposal {
    pub pending_protocol_fee: u64,  // 8
    pub pending_subject_fee:  u64,  // 8
    pub apply_after:          i64,  // 8 — unix ts after which apply_fees may execute
    pub bump:                 u8,   // 1
}
// space = 8 + 25 = 33

/// Pending fee-destination change. Created by propose_fee_destination,
/// consumed by apply_fee_destination after a 48h timelock.
/// Seeds: [b"fee_dest_proposal"]
#[account]
pub struct FeeDestinationProposal {
    pub pending_destination: Pubkey,  // 32
    pub apply_after:         i64,     // 8
    pub bump:                u8,      // 1
}
// space = 8 + 41 = 49

/// Per-name state. One PDA per registered name.
/// Seeds: [b"subject", subject_name.key()]
#[account]
pub struct SubjectState {
    pub subject:          Pubkey,    // 32
    pub supply:           u64,       // 8
    pub price_floor:      u64,       // 8 — legacy/reserved; keep for existing account layout
    pub name:             [u8; 32],  // 32
    pub has_name:         bool,      // 1
    pub royalty_wallet:   Pubkey,    // 32
    pub royalty_percent:  u64,       // 8
    pub mint_bump:        u8,        // 1
    pub bump:             u8,        // 1
}
// space = 8 + 123 = 131

/// Unique name registry. One PDA per registered name.
/// Seeds: [b"name", name.as_bytes()]
#[account]
pub struct SubjectName {
    pub subject: Pubkey,  // 32
    pub bump:    u8,      // 1
}
// space = 8 + 33 = 41
