use anchor_lang::prelude::*;

#[error_code]
pub enum FriendError {
    #[msg("Only the subject can buy the first share")]
    OnlySubjectCanBuyFirst,
    #[msg("Cannot sell the last share")]
    CannotSellLastShare,
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("Insufficient SOL sent")]
    InsufficientPayment,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Caller is not the protocol authority")]
    Unauthorized,
    #[msg("Fee percent exceeds maximum (10% per side, 20% combined)")]
    FeeTooHigh,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Name must be at least 3 characters")]
    NameTooShort,
    #[msg("Name must be at most 32 characters")]
    NameTooLong,
    #[msg("Name may only contain lowercase a-z and 0-9")]
    NameInvalidChars,
    #[msg("This subject already has a name set")]
    NameAlreadySet,
    #[msg("Royalty percent must be 0-100")]
    InvalidRoyaltyPercent,
    #[msg("Royalty wallet does not match stored wallet")]
    InvalidRoyaltyWallet,
    #[msg("Escrow has insufficient SOL for payout")]
    InsufficientEscrow,
    #[msg("Creator first buy cannot exceed 50 keys")]
    ExceedsCreatorFirstBuyLimit,
    #[msg("Creator must buy at least 3 keys at launch")]
    CreatorFirstBuyTooSmall,
    #[msg("Max supply of 10,000 keys reached")]
    MaxSupplyReached,
    #[msg("Buy cost exceeds max_cost slippage guard")]
    SlippageExceeded,
    #[msg("No pending fee change to apply")]
    NoPendingFeeChange,
    #[msg("Fee timelock has not elapsed (48 hours required)")]
    FeeTimelockNotElapsed,
    #[msg("Account must be a System-owned wallet (not a program-owned account)")]
    InvalidWalletAccount,
}
