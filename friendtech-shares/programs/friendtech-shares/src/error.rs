use anchor_lang::prelude::*;

#[error_code]
pub enum FriendError {
    #[msg("Only the subject can buy the first share")]
    OnlySubjectCanBuyFirst,

    #[msg("Cannot sell the last share")]
    CannotSellLastShare,

    #[msg("Insufficient shares to sell")]
    InsufficientShares,

    #[msg("Insufficient SOL sent")]
    InsufficientPayment,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Caller is not the protocol authority")]
    Unauthorized,

    #[msg("Fee percent exceeds maximum (20%)")]
    FeeTooHigh,
}
