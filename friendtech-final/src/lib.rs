use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};
use anchor_spl::metadata::{
    create_metadata_accounts_v3,
    mpl_token_metadata::types::DataV2,
    CreateMetadataAccountsV3,
    Metadata as MetadataProgram,
};

pub mod errors;
pub mod pricing;
pub mod state;

use errors::FriendError;
use pricing::*;
use state::*;
use state::{FeeProposal, FeeDestinationProposal};

declare_id!("983hyfdeswchDLV8epdLGHBCDwTVrkg8BGdxZv5pgMCf");

// 48-hour window before a proposed fee change can be applied
const FEE_TIMELOCK_SECS: i64 = 172_800;

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct TradeEvent {
    pub trader:       Pubkey,
    pub subject:      Pubkey,
    pub is_buy:       bool,
    pub key_amount:   u64,
    pub sol_amount:   u64,
    pub protocol_fee: u64,
    pub subject_fee:  u64,
    pub royalty_fee:  u64,
    pub supply:       u64,
}

#[event]
pub struct KeyCreatedEvent {
    pub creator: Pubkey,
    pub name:    String,
}

#[event]
pub struct RoyaltyChangedEvent {
    pub subject:        Pubkey,
    pub royalty_wallet: Pubkey,
    pub royalty_percent: u64,
}

#[event]
pub struct FeeChangeProposedEvent {
    pub protocol_fee_percent: u64,
    pub subject_fee_percent:  u64,
    pub apply_after:          i64,
}

#[event]
pub struct FeeChangeAppliedEvent {
    pub protocol_fee_percent: u64,
    pub subject_fee_percent:  u64,
}

#[event]
pub struct FeeDestinationProposedEvent {
    pub new_destination: Pubkey,
    pub apply_after:     i64,
}

#[event]
pub struct FeeDestinationAppliedEvent {
    pub new_destination: Pubkey,
}

// ─── Program ─────────────────────────────────────────────────────────────────

#[program]
pub mod friendtech_shares {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        protocol_fee_percent: u64,
        subject_fee_percent: u64,
    ) -> Result<()> {
        require!(protocol_fee_percent <= 100_000_000, FriendError::FeeTooHigh);
        require!(subject_fee_percent  <= 100_000_000, FriendError::FeeTooHigh);
        let config = &mut ctx.accounts.config;
        config.authority            = ctx.accounts.authority.key();
        config.fee_destination      = ctx.accounts.authority.key();
        config.burn_destination     = ctx.accounts.authority.key();
        config.protocol_fee_percent = protocol_fee_percent;
        config.subject_fee_percent  = subject_fee_percent;
        config.bump                 = ctx.bumps.config;
        Ok(())
    }

    /// Stage a fee change. Becomes effective only after FEE_TIMELOCK_SECS (48h).
    /// Creates or overwrites the fee_proposal PDA (resetting the 48h timer).
    pub fn propose_fees(
        ctx: Context<ProposeFees>,
        protocol_fee_percent: u64,
        subject_fee_percent: u64,
    ) -> Result<()> {
        require!(ctx.accounts.authority.key() == ctx.accounts.config.authority, FriendError::Unauthorized);
        require!(protocol_fee_percent <= 100_000_000, FriendError::FeeTooHigh);
        require!(subject_fee_percent  <= 100_000_000, FriendError::FeeTooHigh);

        let apply_after = Clock::get()?.unix_timestamp
            .checked_add(FEE_TIMELOCK_SECS)
            .ok_or(error!(FriendError::MathOverflow))?;

        let proposal = &mut ctx.accounts.fee_proposal;
        proposal.pending_protocol_fee = protocol_fee_percent;
        proposal.pending_subject_fee  = subject_fee_percent;
        proposal.apply_after          = apply_after;
        proposal.bump                 = ctx.bumps.fee_proposal;

        emit!(FeeChangeProposedEvent {
            protocol_fee_percent,
            subject_fee_percent,
            apply_after,
        });
        Ok(())
    }

    /// Apply a previously proposed fee change after the timelock has elapsed.
    /// Closes the fee_proposal PDA, returning rent to the authority.
    pub fn apply_fees(ctx: Context<ApplyFees>) -> Result<()> {
        require!(ctx.accounts.authority.key() == ctx.accounts.config.authority, FriendError::Unauthorized);

        let proposal = &ctx.accounts.fee_proposal;
        require!(
            Clock::get()?.unix_timestamp >= proposal.apply_after,
            FriendError::FeeTimelockNotElapsed
        );

        let config = &mut ctx.accounts.config;
        config.protocol_fee_percent = proposal.pending_protocol_fee;
        config.subject_fee_percent  = proposal.pending_subject_fee;

        emit!(FeeChangeAppliedEvent {
            protocol_fee_percent: config.protocol_fee_percent,
            subject_fee_percent:  config.subject_fee_percent,
        });
        Ok(())
    }

    /// Stage a fee-destination change. Becomes effective only after FEE_TIMELOCK_SECS
    /// (48h) — gives holders time to exit if they distrust the new destination.
    /// Creates or overwrites the fee_dest_proposal PDA (resetting the 48h timer).
    pub fn propose_fee_destination(ctx: Context<ProposeFeeDestination>) -> Result<()> {
        require!(ctx.accounts.authority.key() == ctx.accounts.config.authority, FriendError::Unauthorized);

        let apply_after = Clock::get()?.unix_timestamp
            .checked_add(FEE_TIMELOCK_SECS)
            .ok_or(error!(FriendError::MathOverflow))?;

        let proposal = &mut ctx.accounts.fee_dest_proposal;
        proposal.pending_destination = ctx.accounts.new_destination.key();
        proposal.apply_after          = apply_after;
        proposal.bump                 = ctx.bumps.fee_dest_proposal;

        emit!(FeeDestinationProposedEvent {
            new_destination: proposal.pending_destination,
            apply_after,
        });
        Ok(())
    }

    /// Apply a previously proposed fee-destination change after the timelock has elapsed.
    /// Closes the fee_dest_proposal PDA, returning rent to the authority.
    pub fn apply_fee_destination(ctx: Context<ApplyFeeDestination>) -> Result<()> {
        require!(ctx.accounts.authority.key() == ctx.accounts.config.authority, FriendError::Unauthorized);

        let proposal = &ctx.accounts.fee_dest_proposal;
        require!(
            Clock::get()?.unix_timestamp >= proposal.apply_after,
            FriendError::FeeTimelockNotElapsed
        );

        ctx.accounts.config.fee_destination = proposal.pending_destination;

        emit!(FeeDestinationAppliedEvent {
            new_destination: proposal.pending_destination,
        });
        Ok(())
    }

    /// Create a named key — one tx creates SubjectName + SubjectState + Mint + Metaplex metadata.
    /// `uri` is the Metaplex metadata JSON URL (frontend supplies it based on env).
    pub fn create_key(ctx: Context<CreateKey>, name: String, uri: String) -> Result<()> {
        require!(name.len() >= 3,  FriendError::NameTooShort);
        require!(name.len() <= 32, FriendError::NameTooLong);
        require!(
            name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
            FriendError::NameInvalidChars
        );
        // Metaplex hard-limits: name ≤ 32 (already), symbol ≤ 10, uri ≤ 200
        require!(uri.len() <= 200, FriendError::NameTooLong);

        ctx.accounts.subject_name.subject = ctx.accounts.creator.key();
        ctx.accounts.subject_name.bump    = ctx.bumps.subject_name;

        let ss            = &mut ctx.accounts.subject_state;
        ss.subject        = ctx.accounts.creator.key();
        ss.supply         = 0;
        ss.price_floor    = 0;
        let bytes = name.as_bytes();
        ss.name[..bytes.len()].copy_from_slice(bytes);
        ss.has_name       = true;
        ss.royalty_wallet = ctx.accounts.creator.key();
        ss.royalty_percent = 0;
        ss.mint_bump      = ctx.bumps.mint;
        ss.bump           = ctx.bumps.subject_state;

        // ── Create the Metaplex Token Metadata account ───────────────────────
        // Makes the SPL mint show up in wallets (Phantom, Solflare, Backpack)
        // with the key name + symbol + image instead of "Unknown Token".
        // Signed by subject_state PDA (which is the mint authority).
        let sn_bytes  = ctx.accounts.subject_name.key().to_bytes();
        let state_bump = ctx.bumps.subject_state;
        let seeds = &[b"subject".as_ref(), sn_bytes.as_ref(), std::slice::from_ref(&state_bump)];
        let signer: &[&[&[u8]]] = &[seeds];

        // Symbol = uppercase of name, capped at Metaplex's 10-char limit
        let symbol: String = name.to_uppercase().chars().take(10).collect();

        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata:         ctx.accounts.metadata.to_account_info(),
                    mint:             ctx.accounts.mint.to_account_info(),
                    mint_authority:   ctx.accounts.subject_state.to_account_info(),
                    payer:            ctx.accounts.creator.to_account_info(),
                    update_authority: ctx.accounts.subject_state.to_account_info(),
                    system_program:   ctx.accounts.system_program.to_account_info(),
                    rent:             ctx.accounts.rent.to_account_info(),
                },
                signer,
            ),
            DataV2 {
                name: name.clone(),
                symbol,
                uri,
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            },
            true,   // is_mutable — allow updating later via setMetadata if we add it
            true,   // update_authority_is_signer
            None,   // collection_details
        )?;

        emit!(KeyCreatedEvent { creator: ctx.accounts.creator.key(), name });
        Ok(())
    }

    /// Set the royalty wallet and percent. The new wallet is passed as an account
    /// (not a raw Pubkey) so we can validate it is a System-owned wallet — otherwise
    /// future buys would silently send royalty SOL to an inaccessible program PDA.
    pub fn set_royalty_wallet(
        ctx: Context<SetRoyaltyWallet>,
        percent: u64,
    ) -> Result<()> {
        require!(percent <= 100, FriendError::InvalidRoyaltyPercent);
        let wallet = ctx.accounts.new_royalty_wallet.key();
        ctx.accounts.subject_state.royalty_wallet  = wallet;
        ctx.accounts.subject_state.royalty_percent = percent;

        emit!(RoyaltyChangedEvent {
            subject:         ctx.accounts.subject_state.subject,
            royalty_wallet:  wallet,
            royalty_percent: percent,
        });
        Ok(())
    }

    /// Buy `amount` keys. `max_cost` is a caller-specified slippage cap in lamports —
    /// the tx reverts if computed total_cost exceeds it, protecting against front-running.
    pub fn buy_shares(ctx: Context<BuyShares>, amount: u64, max_cost: u64) -> Result<()> {
        require!(amount > 0, FriendError::ZeroAmount);

        let supply          = ctx.accounts.subject_state.supply;
        let buyer_key       = ctx.accounts.buyer.key();
        let subject_key     = ctx.accounts.subject.key();
        let state_bump      = ctx.accounts.subject_state.bump;
        let royalty_percent = ctx.accounts.subject_state.royalty_percent;
        let proto_pct       = ctx.accounts.config.protocol_fee_percent;
        let subj_pct        = ctx.accounts.config.subject_fee_percent;

        require!(supply > 0 || subject_key == buyer_key, FriendError::OnlySubjectCanBuyFirst);
        if supply == 0 {
            require!(amount >= crate::pricing::CREATOR_FIRST_BUY_MIN, FriendError::CreatorFirstBuyTooSmall);
            require!(amount <= crate::pricing::CREATOR_FIRST_BUY_MAX, FriendError::ExceedsCreatorFirstBuyLimit);
        }

        let price             = get_buy_price(supply, amount)?;
        let protocol_fee      = (price as u128 * proto_pct as u128 / 1_000_000_000) as u64;
        let subject_fee_total = (price as u128 * subj_pct  as u128 / 1_000_000_000) as u64;
        let royalty_cut       = (subject_fee_total as u128 * royalty_percent as u128 / 100) as u64;
        let creator_cut       = subject_fee_total - royalty_cut;
        let total_cost        = price
            .checked_add(protocol_fee)
            .and_then(|v| v.checked_add(subject_fee_total))
            .ok_or(error!(FriendError::MathOverflow))?;

        // Slippage guard: revert if price moved against buyer since they built the tx
        require!(total_cost <= max_cost, FriendError::SlippageExceeded);
        require!(ctx.accounts.buyer.lamports() >= total_cost, FriendError::InsufficientPayment);

        let new_supply = supply.checked_add(amount).ok_or(error!(FriendError::MathOverflow))?;
        ctx.accounts.subject_state.supply = new_supply;

        let sn_bytes = ctx.accounts.subject_name.key().to_bytes();
        let seeds    = &[b"subject".as_ref(), sn_bytes.as_ref(), &[state_bump]];
        let signer   = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint:      ctx.accounts.mint.to_account_info(),
                    to:        ctx.accounts.buyer_ata.to_account_info(),
                    authority: ctx.accounts.subject_state.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to:   ctx.accounts.fee_destination.to_account_info(),
            }),
            protocol_fee,
        )?;

        if creator_cut > 0 {
            system_program::transfer(
                CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to:   ctx.accounts.subject.to_account_info(),
                }),
                creator_cut,
            )?;
        }

        if royalty_cut > 0 {
            system_program::transfer(
                CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to:   ctx.accounts.royalty_wallet.to_account_info(),
                }),
                royalty_cut,
            )?;
        }

        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to:   ctx.accounts.subject_state.to_account_info(),
            }),
            price,
        )?;

        emit!(TradeEvent {
            trader: buyer_key, subject: subject_key, is_buy: true,
            key_amount: amount, sol_amount: price,
            protocol_fee, subject_fee: subject_fee_total, royalty_fee: royalty_cut,
            supply: new_supply,
        });
        Ok(())
    }

    pub fn sell_shares(ctx: Context<SellShares>, amount: u64) -> Result<()> {
        require!(amount > 0, FriendError::ZeroAmount);

        let supply          = ctx.accounts.subject_state.supply;
        let seller_key      = ctx.accounts.seller.key();
        let subject_key     = ctx.accounts.subject.key();
        let fee_dest_key    = ctx.accounts.fee_destination.key();
        let royalty_key     = ctx.accounts.royalty_wallet.key();
        let royalty_percent = ctx.accounts.subject_state.royalty_percent;
        let proto_pct       = ctx.accounts.config.protocol_fee_percent;
        let subj_pct        = ctx.accounts.config.subject_fee_percent;

        require!(supply > amount, FriendError::CannotSellLastShare);
        require!(ctx.accounts.seller_ata.amount >= amount, FriendError::InsufficientShares);

        let price             = get_sell_price(supply, amount)?;
        let protocol_fee      = (price as u128 * proto_pct as u128 / 1_000_000_000) as u64;
        let subject_fee_total = (price as u128 * subj_pct  as u128 / 1_000_000_000) as u64;
        let royalty_cut       = (subject_fee_total as u128 * royalty_percent as u128 / 100) as u64;
        let creator_cut       = subject_fee_total - royalty_cut;
        // checked_sub: fees are derived from price so this cannot underflow under correct fee caps,
        // but we guard anyway to be safe against any future fee logic changes
        let seller_payout     = price
            .checked_sub(protocol_fee)
            .and_then(|v| v.checked_sub(subject_fee_total))
            .ok_or(error!(FriendError::MathOverflow))?;
        let total_out         = seller_payout
            .checked_add(protocol_fee)
            .and_then(|v| v.checked_add(subject_fee_total))
            .ok_or(error!(FriendError::MathOverflow))?;

        let rent_min = Rent::get()?.minimum_balance(
            ctx.accounts.subject_state.to_account_info().data_len()
        );
        require!(
            ctx.accounts.subject_state.to_account_info().lamports() >= rent_min + total_out,
            FriendError::InsufficientEscrow
        );

        ctx.accounts.subject_state.supply =
            supply.checked_sub(amount).ok_or(error!(FriendError::MathOverflow))?;
        let new_supply = ctx.accounts.subject_state.supply;

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint:      ctx.accounts.mint.to_account_info(),
                    from:      ctx.accounts.seller_ata.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            amount,
        )?;

        let escrow = ctx.accounts.subject_state.to_account_info();
        **escrow.try_borrow_mut_lamports()? = escrow.lamports()
            .checked_sub(total_out).ok_or(error!(FriendError::MathOverflow))?;

        let mut seller_amount  = seller_payout;
        let mut fee_amount     = protocol_fee;
        let mut subject_amount = creator_cut;
        let mut royalty_amount = royalty_cut;

        if subject_key == seller_key {
            seller_amount = seller_amount.checked_add(subject_amount).ok_or(error!(FriendError::MathOverflow))?;
            subject_amount = 0;
        }
        if royalty_key == seller_key {
            seller_amount = seller_amount.checked_add(royalty_amount).ok_or(error!(FriendError::MathOverflow))?;
            royalty_amount = 0;
        } else if royalty_key == fee_dest_key {
            fee_amount = fee_amount.checked_add(royalty_amount).ok_or(error!(FriendError::MathOverflow))?;
            royalty_amount = 0;
        } else if royalty_key == subject_key {
            subject_amount = subject_amount.checked_add(royalty_amount).ok_or(error!(FriendError::MathOverflow))?;
            royalty_amount = 0;
        }
        if fee_dest_key == seller_key {
            seller_amount = seller_amount.checked_add(fee_amount).ok_or(error!(FriendError::MathOverflow))?;
            fee_amount = 0;
        } else if fee_dest_key == subject_key {
            subject_amount = subject_amount.checked_add(fee_amount).ok_or(error!(FriendError::MathOverflow))?;
            fee_amount = 0;
        }

        if seller_amount > 0 {
            let seller = ctx.accounts.seller.to_account_info();
            **seller.try_borrow_mut_lamports()? = seller.lamports()
                .checked_add(seller_amount).ok_or(error!(FriendError::MathOverflow))?;
        }
        if fee_amount > 0 {
            let fee_destination = ctx.accounts.fee_destination.to_account_info();
            **fee_destination.try_borrow_mut_lamports()? = fee_destination.lamports()
                .checked_add(fee_amount).ok_or(error!(FriendError::MathOverflow))?;
        }
        if subject_amount > 0 {
            let subject = ctx.accounts.subject.to_account_info();
            **subject.try_borrow_mut_lamports()? = subject.lamports()
                .checked_add(subject_amount).ok_or(error!(FriendError::MathOverflow))?;
        }
        if royalty_amount > 0 {
            let royalty_wallet = ctx.accounts.royalty_wallet.to_account_info();
            **royalty_wallet.try_borrow_mut_lamports()? = royalty_wallet.lamports()
                .checked_add(royalty_amount).ok_or(error!(FriendError::MathOverflow))?;
        }

        emit!(TradeEvent {
            trader: seller_key, subject: subject_key, is_buy: false,
            key_amount: amount, sol_amount: price,
            protocol_fee, subject_fee: subject_fee_total, royalty_fee: royalty_cut,
            supply: new_supply,
        });
        Ok(())
    }
}

// ─── Context structs ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    // Authority becomes fee_destination by default, so it must be a System-owned wallet
    // (otherwise SOL fee distributions would silently go to a program-owned account).
    #[account(
        mut,
        constraint = authority.to_account_info().owner == &system_program::ID @ FriendError::InvalidWalletAccount
    )]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + 113, seeds = [b"config"], bump)]
    pub config: Account<'info, ProtocolConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init_if_needed,
        payer  = authority,
        space  = 8 + 25,
        seeds  = [b"fee_proposal"],
        bump
    )]
    pub fee_proposal: Account<'info, FeeProposal>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApplyFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        close  = authority,
        seeds  = [b"fee_proposal"],
        bump   = fee_proposal.bump
    )]
    pub fee_proposal: Account<'info, FeeProposal>,
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
pub struct ProposeFeeDestination<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    /// New fee destination — SystemAccount<'info> enforces this is a System-owned wallet,
    /// preventing future protocol fee loss to an inaccessible program PDA.
    pub new_destination: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer  = authority,
        space  = 8 + 41,
        seeds  = [b"fee_dest_proposal"],
        bump
    )]
    pub fee_dest_proposal: Account<'info, FeeDestinationProposal>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApplyFeeDestination<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        close = authority,
        seeds = [b"fee_dest_proposal"],
        bump  = fee_dest_proposal.bump
    )]
    pub fee_dest_proposal: Account<'info, FeeDestinationProposal>,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreateKey<'info> {
    // Creator is stored as both `subject` and default `royalty_wallet`. Both must be
    // System-owned wallets so SOL distributions on buy work — reject program PDAs here.
    #[account(
        mut,
        constraint = creator.to_account_info().owner == &system_program::ID @ FriendError::InvalidWalletAccount
    )]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer  = creator,
        space  = 8 + 33,
        seeds  = [b"name", name.as_bytes()],
        bump
    )]
    pub subject_name: Account<'info, SubjectName>,

    #[account(
        init,
        payer  = creator,
        space  = 8 + 123,
        seeds  = [b"subject", subject_name.key().as_ref()],
        bump
    )]
    pub subject_state: Account<'info, SubjectState>,

    #[account(
        init,
        payer           = creator,
        seeds           = [b"mint", subject_name.key().as_ref()],
        bump,
        mint::decimals  = 0,
        mint::authority = subject_state,
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: Metaplex Token Metadata PDA. Address is derived & validated by
    /// the Metaplex program inside the CPI — passing a wrong address would
    /// make `create_metadata_accounts_v3` revert. Frontend computes:
    /// `[b"metadata", MetadataProgram::id(), mint.key()]`.
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    pub token_program:    Program<'info, Token>,
    pub metadata_program: Program<'info, MetadataProgram>,
    pub system_program:   Program<'info, System>,
    pub rent:             Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetRoyaltyWallet<'info> {
    pub creator: Signer<'info>,
    /// CHECK: name registry PDA
    pub subject_name: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"subject", subject_name.key().as_ref()],
        bump  = subject_state.bump,
        constraint = subject_state.subject == creator.key() @ FriendError::Unauthorized
    )]
    pub subject_state: Account<'info, SubjectState>,
    /// New royalty wallet — SystemAccount<'info> enforces the account is owned by
    /// the System program (i.e. a real wallet), preventing silent SOL loss to a PDA.
    pub new_royalty_wallet: SystemAccount<'info>,
}

#[derive(Accounts)]
pub struct BuyShares<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: name registry PDA — used to derive subject_state and mint PDAs
    pub subject_name: AccountInfo<'info>,

    /// Creator wallet — receives subject fee. SystemAccount<'info> enforces this is a
    /// System-owned wallet so system_program::transfer can actually deliver SOL to it.
    #[account(
        mut,
        constraint = subject.key() == subject_state.subject @ FriendError::Unauthorized
    )]
    pub subject: SystemAccount<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,

    /// Protocol fee destination — must equal config.fee_destination and be a System wallet.
    #[account(
        mut,
        constraint = fee_destination.key() == config.fee_destination @ FriendError::Unauthorized
    )]
    pub fee_destination: SystemAccount<'info>,

    /// Royalty wallet — must match subject_state.royalty_wallet (or be ignored if
    /// royalty_percent == 0) and be a System wallet.
    #[account(
        mut,
        constraint = subject_state.royalty_percent == 0
            || royalty_wallet.key() == subject_state.royalty_wallet
            @ FriendError::InvalidRoyaltyWallet
    )]
    pub royalty_wallet: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"subject", subject_name.key().as_ref()],
        bump  = subject_state.bump
    )]
    pub subject_state: Account<'info, SubjectState>,

    #[account(
        mut,
        seeds = [b"mint", subject_name.key().as_ref()],
        bump  = subject_state.mint_bump
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer                       = buyer,
        associated_token::mint      = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_ata: Account<'info, TokenAccount>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellShares<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: name registry PDA
    pub subject_name: AccountInfo<'info>,

    /// CHECK: creator wallet — receives creator cut
    #[account(
        mut,
        constraint = subject.key() == subject_state.subject @ FriendError::Unauthorized
    )]
    pub subject: AccountInfo<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,

    /// CHECK: must equal config.fee_destination
    #[account(
        mut,
        constraint = fee_destination.key() == config.fee_destination @ FriendError::Unauthorized
    )]
    pub fee_destination: AccountInfo<'info>,

    /// CHECK: royalty wallet
    #[account(
        mut,
        constraint = subject_state.royalty_percent == 0
            || royalty_wallet.key() == subject_state.royalty_wallet
            @ FriendError::InvalidRoyaltyWallet
    )]
    pub royalty_wallet: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"subject", subject_name.key().as_ref()],
        bump  = subject_state.bump
    )]
    pub subject_state: Account<'info, SubjectState>,

    #[account(
        mut,
        seeds = [b"mint", subject_name.key().as_ref()],
        bump  = subject_state.mint_bump
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint      = mint,
        associated_token::authority = seller,
    )]
    pub seller_ata: Account<'info, TokenAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
