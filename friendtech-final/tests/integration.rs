//! Integration test suite for friendtech-shares.
//!
//! Runs the on-chain entrypoint in-process via solana-program-test (BanksClient).
//! No external validator required — `cargo test --test integration`.
//!
//! Coverage:
//!   - initialize_protocol  (3 tests)
//!   - create_key           (5 tests)
//!   - buy_shares           (7 tests)
//!   - sell_shares          (5 tests)
//!   - set_royalty_wallet   (4 tests)
//!   - propose/apply fees   (5 tests)
//!   - propose/apply fee_destination (5 tests)
//!   - misc economic invariants (2 tests)

#![allow(clippy::too_many_arguments)]

use anchor_lang::{InstructionData, ToAccountMetas};
use solana_program_test::{processor, BanksClient, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    instruction::{Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction, system_program,
    transaction::{Transaction, TransactionError},
};
use spl_associated_token_account::get_associated_token_address;

// ─── Adapter for processor! lifetime mismatch ────────────────────────────────

fn entry_adapter<'a, 'b, 'c, 'd>(
    program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    data: &'d [u8],
) -> ProgramResult {
    let accounts_static: &[AccountInfo] = unsafe { std::mem::transmute(accounts) };
    friendtech_shares::entry(program_id, accounts_static, data)
}

// ─── Constants & PDAs ────────────────────────────────────────────────────────

const PROTOCOL_FEE_PERCENT: u64 = 20_000_000; // 2%
const SUBJECT_FEE_PERCENT: u64 = 20_000_000;  // 2%
const FEE_TIMELOCK_SECS: i64 = 172_800;

fn program_id() -> Pubkey {
    friendtech_shares::ID
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &program_id()).0
}

fn fee_proposal_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"fee_proposal"], &program_id()).0
}

fn fee_dest_proposal_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"fee_dest_proposal"], &program_id()).0
}

fn subject_name_pda(name: &str) -> Pubkey {
    Pubkey::find_program_address(&[b"name", name.as_bytes()], &program_id()).0
}

fn subject_state_pda(name: &str) -> Pubkey {
    let name_pda = subject_name_pda(name);
    Pubkey::find_program_address(&[b"subject", name_pda.as_ref()], &program_id()).0
}

fn mint_pda(name: &str) -> Pubkey {
    let name_pda = subject_name_pda(name);
    Pubkey::find_program_address(&[b"mint", name_pda.as_ref()], &program_id()).0
}

// ─── Test harness ────────────────────────────────────────────────────────────

async fn new_ctx() -> ProgramTestContext {
    let pt = ProgramTest::new("friendtech_shares", program_id(), processor!(entry_adapter));
    pt.start_with_context().await
}

async fn fund(ctx: &mut ProgramTestContext, to: &Pubkey, lamports: u64) {
    let ix = system_instruction::transfer(&ctx.payer.pubkey(), to, lamports);
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();
}

async fn send_with(
    banks: &mut BanksClient,
    recent_blockhash: solana_sdk::hash::Hash,
    ix: Instruction,
    signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let payer = signers[0];
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        signers,
        recent_blockhash,
    );
    banks.process_transaction(tx).await
}

// Run a sequence of instructions in a single transaction (e.g. create + buy)
async fn send_many(
    banks: &mut BanksClient,
    recent_blockhash: solana_sdk::hash::Hash,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let payer = signers[0];
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&payer.pubkey()),
        signers,
        recent_blockhash,
    );
    banks.process_transaction(tx).await
}

/// Get the latest blockhash (forces a slot advance so we get a fresh one).
async fn refresh_blockhash(ctx: &mut ProgramTestContext) {
    let new = ctx.banks_client.get_latest_blockhash().await.unwrap();
    if new != ctx.last_blockhash {
        ctx.last_blockhash = new;
    } else {
        // Force advance by warping
        let clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
        let _ = ctx.warp_to_slot(clock.slot + 2);
        ctx.last_blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    }
}

fn anchor_code(err: &BanksClientError) -> Option<u32> {
    match err {
        BanksClientError::TransactionError(TransactionError::InstructionError(_, InstructionError::Custom(c))) => {
            Some(*c)
        }
        BanksClientError::SimulationError { err: TransactionError::InstructionError(_, InstructionError::Custom(c)), .. } => {
            Some(*c)
        }
        _ => None,
    }
}

fn assert_anchor_err(result: Result<(), BanksClientError>, expected_code: u32, ctx_msg: &str) {
    let err = result.expect_err(&format!("{ctx_msg}: expected anchor error, got Ok"));
    let code = anchor_code(&err)
        .unwrap_or_else(|| panic!("{ctx_msg}: not an anchor custom error: {err:?}"));
    assert_eq!(
        code, expected_code,
        "{ctx_msg}: expected anchor error {expected_code}, got {code}"
    );
}

async fn warp_clock_forward(ctx: &mut ProgramTestContext, seconds: i64) {
    let clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
    let mut new_clock = clock.clone();
    new_clock.unix_timestamp = clock.unix_timestamp + seconds;
    ctx.set_sysvar(&new_clock);
}

async fn read_subject_state(ctx: &mut ProgramTestContext, name: &str) -> Vec<u8> {
    ctx.banks_client
        .get_account(subject_state_pda(name))
        .await
        .unwrap()
        .expect("subject_state account missing")
        .data
}

fn parse_supply(data: &[u8]) -> u64 {
    // discriminator(8) + subject(32) = 40; supply is the next u64
    u64::from_le_bytes(data[40..48].try_into().unwrap())
}

async fn get_token_balance(ctx: &mut ProgramTestContext, ata: &Pubkey) -> u64 {
    let acct = ctx
        .banks_client
        .get_account(*ata)
        .await
        .unwrap()
        .expect("ata account missing");
    // SPL token Account layout: mint(32) + owner(32) + amount(u64 LE) at offset 64
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

async fn lamports_of(ctx: &mut ProgramTestContext, addr: &Pubkey) -> u64 {
    ctx.banks_client.get_balance(*addr).await.unwrap()
}

// ─── High-level instruction builders ─────────────────────────────────────────

fn init_protocol_ix(authority: Pubkey, p_fee: u64, s_fee: u64) -> Instruction {
    let data = friendtech_shares::instruction::InitializeProtocol {
        protocol_fee_percent: p_fee,
        subject_fee_percent: s_fee,
    }
    .data();
    let metas = friendtech_shares::accounts::InitializeProtocol {
        authority,
        config: config_pda(),
        system_program: system_program::ID,
    }
    .to_account_metas(None);
    Instruction { program_id: program_id(), accounts: metas, data }
}

fn create_key_ix(creator: Pubkey, name: &str) -> Instruction {
    let data = friendtech_shares::instruction::CreateKey { name: name.to_string() }.data();
    let metas = friendtech_shares::accounts::CreateKey {
        creator,
        subject_name: subject_name_pda(name),
        subject_state: subject_state_pda(name),
        mint: mint_pda(name),
        token_program: anchor_spl::token::ID,
        system_program: system_program::ID,
        rent: solana_sdk::sysvar::rent::ID,
    }
    .to_account_metas(None);
    Instruction { program_id: program_id(), accounts: metas, data }
}

fn buy_shares_ix(
    buyer: Pubkey,
    name: &str,
    amount: u64,
    max_cost: u64,
    subject: Pubkey,
    fee_destination: Pubkey,
    royalty_wallet: Pubkey,
) -> Instruction {
    let mint = mint_pda(name);
    let buyer_ata = get_associated_token_address(&buyer, &mint);
    let data = friendtech_shares::instruction::BuyShares { amount, max_cost }.data();
    let metas = friendtech_shares::accounts::BuyShares {
        buyer,
        subject_name: subject_name_pda(name),
        subject,
        config: config_pda(),
        fee_destination,
        royalty_wallet,
        subject_state: subject_state_pda(name),
        mint,
        buyer_ata,
        token_program: anchor_spl::token::ID,
        associated_token_program: anchor_spl::associated_token::ID,
        system_program: system_program::ID,
    }
    .to_account_metas(None);
    Instruction { program_id: program_id(), accounts: metas, data }
}

fn sell_shares_ix(
    seller: Pubkey,
    name: &str,
    amount: u64,
    subject: Pubkey,
    fee_destination: Pubkey,
    royalty_wallet: Pubkey,
) -> Instruction {
    let mint = mint_pda(name);
    let seller_ata = get_associated_token_address(&seller, &mint);
    let data = friendtech_shares::instruction::SellShares { amount }.data();
    let metas = friendtech_shares::accounts::SellShares {
        seller,
        subject_name: subject_name_pda(name),
        subject,
        config: config_pda(),
        fee_destination,
        royalty_wallet,
        subject_state: subject_state_pda(name),
        mint,
        seller_ata,
        token_program: anchor_spl::token::ID,
        system_program: system_program::ID,
    }
    .to_account_metas(None);
    Instruction { program_id: program_id(), accounts: metas, data }
}

fn set_royalty_ix(creator: Pubkey, name: &str, new_wallet: Pubkey, percent: u64) -> Instruction {
    let data = friendtech_shares::instruction::SetRoyaltyWallet { percent }.data();
    let metas = friendtech_shares::accounts::SetRoyaltyWallet {
        creator,
        subject_name: subject_name_pda(name),
        subject_state: subject_state_pda(name),
        new_royalty_wallet: new_wallet,
    }
    .to_account_metas(None);
    Instruction { program_id: program_id(), accounts: metas, data }
}

fn propose_fees_ix(authority: Pubkey, p_fee: u64, s_fee: u64) -> Instruction {
    let data = friendtech_shares::instruction::ProposeFees {
        protocol_fee_percent: p_fee,
        subject_fee_percent: s_fee,
    }
    .data();
    let metas = friendtech_shares::accounts::ProposeFees {
        authority,
        config: config_pda(),
        fee_proposal: fee_proposal_pda(),
        system_program: system_program::ID,
    }
    .to_account_metas(None);
    Instruction { program_id: program_id(), accounts: metas, data }
}

fn apply_fees_ix(authority: Pubkey) -> Instruction {
    let data = friendtech_shares::instruction::ApplyFees {}.data();
    let metas = friendtech_shares::accounts::ApplyFees {
        authority,
        config: config_pda(),
        fee_proposal: fee_proposal_pda(),
    }
    .to_account_metas(None);
    Instruction { program_id: program_id(), accounts: metas, data }
}

fn propose_fee_dest_ix(authority: Pubkey, new_destination: Pubkey) -> Instruction {
    let data = friendtech_shares::instruction::ProposeFeeDestination {}.data();
    let metas = friendtech_shares::accounts::ProposeFeeDestination {
        authority,
        config: config_pda(),
        new_destination,
        fee_dest_proposal: fee_dest_proposal_pda(),
        system_program: system_program::ID,
    }
    .to_account_metas(None);
    Instruction { program_id: program_id(), accounts: metas, data }
}

fn apply_fee_dest_ix(authority: Pubkey) -> Instruction {
    let data = friendtech_shares::instruction::ApplyFeeDestination {}.data();
    let metas = friendtech_shares::accounts::ApplyFeeDestination {
        authority,
        config: config_pda(),
        fee_dest_proposal: fee_dest_proposal_pda(),
    }
    .to_account_metas(None);
    Instruction { program_id: program_id(), accounts: metas, data }
}

// ─── Convenience flows ───────────────────────────────────────────────────────

async fn init(ctx: &mut ProgramTestContext) {
    let ix = init_protocol_ix(ctx.payer.pubkey(), PROTOCOL_FEE_PERCENT, SUBJECT_FEE_PERCENT);
    send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer])
        .await
        .unwrap();
}

/// Create a key and have the creator buy the minimum 3 keys in one tx.
async fn launch_key(ctx: &mut ProgramTestContext, creator: &Keypair, name: &str) {
    let fee_dest = ctx.payer.pubkey();
    let ix1 = create_key_ix(creator.pubkey(), name);
    let ix2 = buy_shares_ix(
        creator.pubkey(),
        name,
        3,
        10_000_000_000, // generous slippage cap
        creator.pubkey(),
        fee_dest,
        creator.pubkey(),
    );
    send_many(
        &mut ctx.banks_client,
        ctx.last_blockhash,
        &[ix1, ix2],
        &[&ctx.payer, creator],
    )
    .await
    .unwrap();
}

// ─── TESTS — initialize_protocol ─────────────────────────────────────────────

#[tokio::test]
async fn init_happy_path() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let cfg = ctx.banks_client.get_account(config_pda()).await.unwrap().unwrap();
    assert_eq!(cfg.owner, program_id());
    assert_eq!(cfg.data.len(), 8 + 113);
}

#[tokio::test]
async fn init_fee_too_high_protocol() {
    let mut ctx = new_ctx().await;
    let ix = init_protocol_ix(ctx.payer.pubkey(), 100_000_001, SUBJECT_FEE_PERCENT);
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer]).await;
    assert_anchor_err(r, 6006, "init_fee_too_high_protocol");
}

#[tokio::test]
async fn init_fee_too_high_subject() {
    let mut ctx = new_ctx().await;
    let ix = init_protocol_ix(ctx.payer.pubkey(), PROTOCOL_FEE_PERCENT, 100_000_001);
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer]).await;
    assert_anchor_err(r, 6006, "init_fee_too_high_subject");
}

// ─── TESTS — create_key ──────────────────────────────────────────────────────

#[tokio::test]
async fn create_key_happy() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 1_000_000_000).await;
    let ix = create_key_ix(creator.pubkey(), "alice");
    send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator])
        .await
        .unwrap();
    let data = read_subject_state(&mut ctx, "alice").await;
    assert_eq!(parse_supply(&data), 0);
    let subject_bytes = &data[8..40];
    assert_eq!(subject_bytes, creator.pubkey().as_ref());
}

#[tokio::test]
async fn create_name_too_short() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 1_000_000_000).await;
    let ix = create_key_ix(creator.pubkey(), "ab");
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6008, "name_too_short");
}

// NOTE: `create_name_too_long` (>32 chars) is intentionally NOT tested here. A
// 33-byte name violates Solana's per-seed limit, so `find_program_address` panics
// at client-side derivation — the on-chain `NameTooLong` (6009) check is defensive
// and unreachable via any normal client. The bound is enforced upstream by Solana.

#[tokio::test]
async fn create_name_invalid_chars() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 1_000_000_000).await;
    let ix = create_key_ix(creator.pubkey(), "Alice"); // uppercase A
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6010, "name_invalid_chars");
}

#[tokio::test]
async fn create_duplicate_name_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;

    let alice = Keypair::new();
    let bob   = Keypair::new();
    fund(&mut ctx, &alice.pubkey(), 1_000_000_000).await;
    fund(&mut ctx, &bob.pubkey(),   1_000_000_000).await;

    send_with(&mut ctx.banks_client, ctx.last_blockhash, create_key_ix(alice.pubkey(), "shared"), &[&ctx.payer, &alice])
        .await
        .unwrap();
    refresh_blockhash(&mut ctx).await;
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, create_key_ix(bob.pubkey(), "shared"), &[&ctx.payer, &bob]).await;
    // Anchor `init` of a SubjectName that already exists → custom error from system program 0x0
    // (AccountAlreadyInUse). Just assert it's an error.
    assert!(r.is_err(), "duplicate name should fail");
}

// ─── TESTS — buy_shares ──────────────────────────────────────────────────────

#[tokio::test]
async fn buy_first_by_non_creator_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let attacker = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 1_000_000_000).await;
    fund(&mut ctx, &attacker.pubkey(), 1_000_000_000).await;

    send_with(&mut ctx.banks_client, ctx.last_blockhash, create_key_ix(creator.pubkey(), "alpha"), &[&ctx.payer, &creator])
        .await.unwrap();
    refresh_blockhash(&mut ctx).await;

    let ix = buy_shares_ix(attacker.pubkey(), "alpha", 3, 10_000_000_000, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &attacker]).await;
    assert_anchor_err(r, 6000, "OnlySubjectCanBuyFirst");
}

#[tokio::test]
async fn buy_first_too_few_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 1_000_000_000).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, create_key_ix(creator.pubkey(), "beta"), &[&ctx.payer, &creator])
        .await.unwrap();
    refresh_blockhash(&mut ctx).await;
    let ix = buy_shares_ix(creator.pubkey(), "beta", 2, 10_000_000_000, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6016, "CreatorFirstBuyTooSmall");
}

#[tokio::test]
async fn buy_first_too_many_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 200_000_000_000).await; // plenty for 51 keys
    send_with(&mut ctx.banks_client, ctx.last_blockhash, create_key_ix(creator.pubkey(), "gamma"), &[&ctx.payer, &creator])
        .await.unwrap();
    refresh_blockhash(&mut ctx).await;
    let ix = buy_shares_ix(creator.pubkey(), "gamma", 51, 999_000_000_000_000, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6015, "ExceedsCreatorFirstBuyLimit");
}

#[tokio::test]
async fn buy_zero_amount_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 1_000_000_000).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, create_key_ix(creator.pubkey(), "delta"), &[&ctx.payer, &creator])
        .await.unwrap();
    refresh_blockhash(&mut ctx).await;
    let ix = buy_shares_ix(creator.pubkey(), "delta", 0, 1_000_000, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6007, "ZeroAmount");
}

#[tokio::test]
async fn buy_first_by_creator_succeeds_and_mints() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    launch_key(&mut ctx, &creator, "epsilon").await;

    let data = read_subject_state(&mut ctx, "epsilon").await;
    assert_eq!(parse_supply(&data), 3, "supply should be 3 after creator launch buy");
    let ata = get_associated_token_address(&creator.pubkey(), &mint_pda("epsilon"));
    assert_eq!(get_token_balance(&mut ctx, &ata).await, 3, "creator should hold 3 keys");
}

#[tokio::test]
async fn buy_regular_after_first_succeeds() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let buyer = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &buyer.pubkey(),   5_000_000_000).await;
    launch_key(&mut ctx, &creator, "zeta").await;
    refresh_blockhash(&mut ctx).await;

    let ix = buy_shares_ix(buyer.pubkey(), "zeta", 5, 10_000_000_000, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey());
    send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &buyer]).await.unwrap();

    let data = read_subject_state(&mut ctx, "zeta").await;
    assert_eq!(parse_supply(&data), 8, "supply 3 + 5 = 8");
    let ata = get_associated_token_address(&buyer.pubkey(), &mint_pda("zeta"));
    assert_eq!(get_token_balance(&mut ctx, &ata).await, 5);
}

#[tokio::test]
async fn buy_slippage_exceeded() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, create_key_ix(creator.pubkey(), "eta"), &[&ctx.payer, &creator])
        .await.unwrap();
    refresh_blockhash(&mut ctx).await;
    // max_cost = 1 lamport — guaranteed to be exceeded
    let ix = buy_shares_ix(creator.pubkey(), "eta", 3, 1, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6018, "SlippageExceeded");
}

// ─── TESTS — sell_shares ─────────────────────────────────────────────────────

#[tokio::test]
async fn sell_happy_path() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let buyer = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &buyer.pubkey(),   5_000_000_000).await;
    launch_key(&mut ctx, &creator, "theta").await;
    refresh_blockhash(&mut ctx).await;

    // Buyer buys 5
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        buy_shares_ix(buyer.pubkey(), "theta", 5, 10_000_000_000, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey()),
        &[&ctx.payer, &buyer]).await.unwrap();
    refresh_blockhash(&mut ctx).await;

    let supply_before = parse_supply(&read_subject_state(&mut ctx, "theta").await);
    let ata = get_associated_token_address(&buyer.pubkey(), &mint_pda("theta"));
    let bal_before = get_token_balance(&mut ctx, &ata).await;
    let lam_before = lamports_of(&mut ctx, &buyer.pubkey()).await;

    // Sell 2
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        sell_shares_ix(buyer.pubkey(), "theta", 2, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey()),
        &[&ctx.payer, &buyer]).await.unwrap();

    let supply_after = parse_supply(&read_subject_state(&mut ctx, "theta").await);
    assert_eq!(supply_after, supply_before - 2);
    assert_eq!(get_token_balance(&mut ctx, &ata).await, bal_before - 2);
    assert!(lamports_of(&mut ctx, &buyer.pubkey()).await > lam_before, "buyer should receive SOL");
}

#[tokio::test]
async fn sell_last_share_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    launch_key(&mut ctx, &creator, "iota").await;
    refresh_blockhash(&mut ctx).await;
    // creator owns 3 — try to sell all 3 (would leave supply=0)
    let ix = sell_shares_ix(creator.pubkey(), "iota", 3, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6001, "CannotSellLastShare");
}

#[tokio::test]
async fn sell_insufficient_shares_fails() {
    // Need supply > amount (else CannotSellLastShare fires first) AND seller_ata < amount.
    // Setup: creator buys 3, buyer1 buys 7 (supply=10), buyer2 buys 2 (supply=12, holds 2),
    // buyer2 tries to sell 5 → supply (12) > 5 ✓ but ata (2) < 5 → InsufficientShares.
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let buyer1  = Keypair::new();
    let buyer2  = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 10_000_000_000).await;
    fund(&mut ctx, &buyer1.pubkey(),  10_000_000_000).await;
    fund(&mut ctx, &buyer2.pubkey(),  10_000_000_000).await;
    launch_key(&mut ctx, &creator, "kappa").await;
    refresh_blockhash(&mut ctx).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        buy_shares_ix(buyer1.pubkey(), "kappa", 7, 10_000_000_000, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey()),
        &[&ctx.payer, &buyer1]).await.unwrap();
    refresh_blockhash(&mut ctx).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        buy_shares_ix(buyer2.pubkey(), "kappa", 2, 10_000_000_000, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey()),
        &[&ctx.payer, &buyer2]).await.unwrap();
    refresh_blockhash(&mut ctx).await;
    // buyer2 holds 2 but tries to sell 5 — supply=12 > 5 so CannotSellLastShare doesn't fire
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash,
        sell_shares_ix(buyer2.pubkey(), "kappa", 5, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey()),
        &[&ctx.payer, &buyer2]).await;
    assert_anchor_err(r, 6002, "InsufficientShares");
}

#[tokio::test]
async fn sell_zero_amount_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    launch_key(&mut ctx, &creator, "lambda").await;
    refresh_blockhash(&mut ctx).await;
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash,
        sell_shares_ix(creator.pubkey(), "lambda", 0, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey()),
        &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6007, "ZeroAmount");
}

#[tokio::test]
async fn escrow_grows_per_buy_sell_cycle() {
    // Selling pays out strictly less than buying deposits — escrow always grows.
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 10_000_000_000).await;
    launch_key(&mut ctx, &creator, "mukey").await;
    refresh_blockhash(&mut ctx).await;

    let state_pda = subject_state_pda("mukey");
    let escrow_after_launch = lamports_of(&mut ctx, &state_pda).await;

    let buyer = Keypair::new();
    fund(&mut ctx, &buyer.pubkey(), 10_000_000_000).await;
    refresh_blockhash(&mut ctx).await;

    // Buy 5
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        buy_shares_ix(buyer.pubkey(), "mukey", 5, 10_000_000_000, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey()),
        &[&ctx.payer, &buyer]).await.unwrap();
    let escrow_after_buy = lamports_of(&mut ctx, &state_pda).await;
    assert!(escrow_after_buy > escrow_after_launch);

    refresh_blockhash(&mut ctx).await;
    // Sell 5 back
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        sell_shares_ix(buyer.pubkey(), "mukey", 5, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey()),
        &[&ctx.payer, &buyer]).await.unwrap();
    let escrow_after_sell = lamports_of(&mut ctx, &state_pda).await;
    // Escrow grew because sell payout (95%) < buy deposit (100%)
    assert!(escrow_after_sell > escrow_after_launch, "escrow must grow per round trip");
    assert!(escrow_after_sell < escrow_after_buy, "escrow must shrink on sell");
}

// ─── TESTS — set_royalty_wallet ──────────────────────────────────────────────

#[tokio::test]
async fn set_royalty_happy() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let new_royalty = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &new_royalty.pubkey(), 100_000_000).await; // make it a real System wallet
    launch_key(&mut ctx, &creator, "nukey").await;
    refresh_blockhash(&mut ctx).await;
    let ix = set_royalty_ix(creator.pubkey(), "nukey", new_royalty.pubkey(), 50);
    send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await.unwrap();
}

#[tokio::test]
async fn set_royalty_unauthorized() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let attacker = Keypair::new();
    let new_royalty = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &attacker.pubkey(), 100_000_000).await;
    fund(&mut ctx, &new_royalty.pubkey(), 100_000_000).await;
    launch_key(&mut ctx, &creator, "xikey").await;
    refresh_blockhash(&mut ctx).await;
    let ix = set_royalty_ix(attacker.pubkey(), "xikey", new_royalty.pubkey(), 50);
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &attacker]).await;
    assert_anchor_err(r, 6005, "Unauthorized");
}

#[tokio::test]
async fn set_royalty_percent_too_high() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let new_royalty = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &new_royalty.pubkey(), 100_000_000).await;
    launch_key(&mut ctx, &creator, "omicron").await;
    refresh_blockhash(&mut ctx).await;
    let ix = set_royalty_ix(creator.pubkey(), "omicron", new_royalty.pubkey(), 101);
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6012, "InvalidRoyaltyPercent");
}

#[tokio::test]
async fn set_royalty_pda_rejected() {
    // Pass the program's own PDA (config) as the new royalty wallet — should be
    // rejected by SystemAccount<'info> validation (NOT a System-owned account).
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    launch_key(&mut ctx, &creator, "pikey").await;
    refresh_blockhash(&mut ctx).await;
    let ix = set_royalty_ix(creator.pubkey(), "pikey", config_pda(), 50); // config_pda owned by our program
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert!(r.is_err(), "expected error when royalty is a program PDA");
}

// ─── TESTS — fee % timelock ──────────────────────────────────────────────────

#[tokio::test]
async fn propose_fees_unauthorized() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let attacker = Keypair::new();
    fund(&mut ctx, &attacker.pubkey(), 100_000_000).await;
    let ix = propose_fees_ix(attacker.pubkey(), 50_000_000, 50_000_000);
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &attacker]).await;
    assert_anchor_err(r, 6005, "Unauthorized");
}

#[tokio::test]
async fn propose_fees_too_high() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let ix = propose_fees_ix(ctx.payer.pubkey(), 100_000_001, 50_000_000);
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer]).await;
    assert_anchor_err(r, 6006, "FeeTooHigh");
}

#[tokio::test]
async fn apply_fees_before_timelock_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, propose_fees_ix(ctx.payer.pubkey(), 50_000_000, 50_000_000), &[&ctx.payer])
        .await.unwrap();
    refresh_blockhash(&mut ctx).await;
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, apply_fees_ix(ctx.payer.pubkey()), &[&ctx.payer]).await;
    assert_anchor_err(r, 6020, "FeeTimelockNotElapsed");
}

#[tokio::test]
async fn apply_fees_after_timelock_works() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, propose_fees_ix(ctx.payer.pubkey(), 50_000_000, 50_000_000), &[&ctx.payer])
        .await.unwrap();
    warp_clock_forward(&mut ctx, FEE_TIMELOCK_SECS + 10).await;
    refresh_blockhash(&mut ctx).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, apply_fees_ix(ctx.payer.pubkey()), &[&ctx.payer])
        .await.unwrap();
    // Verify config now has new fees
    let cfg = ctx.banks_client.get_account(config_pda()).await.unwrap().unwrap();
    // layout: disc(8) authority(32) feeDest(32) burnDest(32) protocolFee(8) subjectFee(8) bump(1)
    let p = u64::from_le_bytes(cfg.data[8 + 96..8 + 96 + 8].try_into().unwrap());
    let s = u64::from_le_bytes(cfg.data[8 + 96 + 8..8 + 96 + 16].try_into().unwrap());
    assert_eq!(p, 50_000_000);
    assert_eq!(s, 50_000_000);
}

#[tokio::test]
async fn propose_fees_overwrites_resets_timer() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, propose_fees_ix(ctx.payer.pubkey(), 30_000_000, 30_000_000), &[&ctx.payer])
        .await.unwrap();
    warp_clock_forward(&mut ctx, FEE_TIMELOCK_SECS - 100).await; // almost ready
    refresh_blockhash(&mut ctx).await;
    // re-propose — timer should reset
    send_with(&mut ctx.banks_client, ctx.last_blockhash, propose_fees_ix(ctx.payer.pubkey(), 40_000_000, 40_000_000), &[&ctx.payer])
        .await.unwrap();
    refresh_blockhash(&mut ctx).await;
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, apply_fees_ix(ctx.payer.pubkey()), &[&ctx.payer]).await;
    assert_anchor_err(r, 6020, "timer should have reset");
}

// ─── TESTS — fee destination timelock ────────────────────────────────────────

#[tokio::test]
async fn propose_fee_dest_happy() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let new_dest = Keypair::new();
    fund(&mut ctx, &new_dest.pubkey(), 100_000_000).await;
    refresh_blockhash(&mut ctx).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, propose_fee_dest_ix(ctx.payer.pubkey(), new_dest.pubkey()), &[&ctx.payer])
        .await.unwrap();
}

#[tokio::test]
async fn propose_fee_dest_unauthorized() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let attacker = Keypair::new();
    let new_dest = Keypair::new();
    fund(&mut ctx, &attacker.pubkey(), 100_000_000).await;
    fund(&mut ctx, &new_dest.pubkey(), 100_000_000).await;
    let ix = propose_fee_dest_ix(attacker.pubkey(), new_dest.pubkey());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &attacker]).await;
    assert_anchor_err(r, 6005, "Unauthorized");
}

#[tokio::test]
async fn apply_fee_dest_before_timelock_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let new_dest = Keypair::new();
    fund(&mut ctx, &new_dest.pubkey(), 100_000_000).await;
    refresh_blockhash(&mut ctx).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, propose_fee_dest_ix(ctx.payer.pubkey(), new_dest.pubkey()), &[&ctx.payer])
        .await.unwrap();
    refresh_blockhash(&mut ctx).await;
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, apply_fee_dest_ix(ctx.payer.pubkey()), &[&ctx.payer]).await;
    assert_anchor_err(r, 6020, "FeeTimelockNotElapsed");
}

#[tokio::test]
async fn apply_fee_dest_after_timelock_works() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let new_dest = Keypair::new();
    fund(&mut ctx, &new_dest.pubkey(), 100_000_000).await;
    refresh_blockhash(&mut ctx).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, propose_fee_dest_ix(ctx.payer.pubkey(), new_dest.pubkey()), &[&ctx.payer])
        .await.unwrap();
    warp_clock_forward(&mut ctx, FEE_TIMELOCK_SECS + 10).await;
    refresh_blockhash(&mut ctx).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, apply_fee_dest_ix(ctx.payer.pubkey()), &[&ctx.payer])
        .await.unwrap();
    // Verify config.fee_destination updated
    let cfg = ctx.banks_client.get_account(config_pda()).await.unwrap().unwrap();
    // offset 8 (disc) + 32 (authority) = 40
    let dest: [u8; 32] = cfg.data[40..72].try_into().unwrap();
    assert_eq!(dest, new_dest.pubkey().to_bytes());
}

#[tokio::test]
async fn propose_fee_dest_rejects_program_pda() {
    // Pass program-owned PDA — SystemAccount<'info> on new_destination must reject.
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let ix = propose_fee_dest_ix(ctx.payer.pubkey(), config_pda());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer]).await;
    assert!(r.is_err(), "must reject program-owned destination");
}

// ─── TESTS — security: account constraint enforcement ────────────────────────

#[tokio::test]
async fn buy_with_wrong_fee_destination_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let attacker_dest = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &attacker_dest.pubkey(), 100_000_000).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, create_key_ix(creator.pubkey(), "secfee"), &[&ctx.payer, &creator])
        .await.unwrap();
    refresh_blockhash(&mut ctx).await;
    // Pass an unrelated wallet as fee_destination instead of config.fee_destination
    let ix = buy_shares_ix(creator.pubkey(), "secfee", 3, 10_000_000_000, creator.pubkey(), attacker_dest.pubkey(), creator.pubkey());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6005, "Unauthorized — wrong fee_destination");
}

#[tokio::test]
async fn buy_with_wrong_subject_fails() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let attacker = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &attacker.pubkey(), 100_000_000).await;
    send_with(&mut ctx.banks_client, ctx.last_blockhash, create_key_ix(creator.pubkey(), "secsub"), &[&ctx.payer, &creator])
        .await.unwrap();
    refresh_blockhash(&mut ctx).await;
    // Pass attacker as `subject` instead of creator — should fail Unauthorized constraint
    let ix = buy_shares_ix(creator.pubkey(), "secsub", 3, 10_000_000_000, attacker.pubkey(), ctx.payer.pubkey(), creator.pubkey());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &creator]).await;
    assert_anchor_err(r, 6005, "Unauthorized — wrong subject");
}

#[tokio::test]
async fn buy_with_wrong_royalty_wallet_fails_when_percent_nonzero() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let real_royalty = Keypair::new();
    let attacker_royalty = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &real_royalty.pubkey(), 100_000_000).await;
    fund(&mut ctx, &attacker_royalty.pubkey(), 100_000_000).await;
    launch_key(&mut ctx, &creator, "secroy").await;
    refresh_blockhash(&mut ctx).await;
    // Creator sets a specific royalty wallet
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        set_royalty_ix(creator.pubkey(), "secroy", real_royalty.pubkey(), 50),
        &[&ctx.payer, &creator]).await.unwrap();
    refresh_blockhash(&mut ctx).await;
    // Buyer passes a DIFFERENT royalty wallet — must fail InvalidRoyaltyWallet
    let buyer = Keypair::new();
    fund(&mut ctx, &buyer.pubkey(), 5_000_000_000).await;
    refresh_blockhash(&mut ctx).await;
    let ix = buy_shares_ix(buyer.pubkey(), "secroy", 2, 10_000_000_000, creator.pubkey(), ctx.payer.pubkey(), attacker_royalty.pubkey());
    let r = send_with(&mut ctx.banks_client, ctx.last_blockhash, ix, &[&ctx.payer, &buyer]).await;
    assert_anchor_err(r, 6013, "InvalidRoyaltyWallet");
}

#[tokio::test]
async fn sell_by_creator_merges_subject_fee_into_payout() {
    // When seller == subject, the subject_fee portion is merged into seller_amount
    // (no separate transfer to subject — it would be self-transfer).
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let buyer = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &buyer.pubkey(),   5_000_000_000).await;
    launch_key(&mut ctx, &creator, "selfee").await;
    refresh_blockhash(&mut ctx).await;
    // Buyer buys 5 to bump supply so creator can sell without hitting CannotSellLastShare
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        buy_shares_ix(buyer.pubkey(), "selfee", 5, 10_000_000_000, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey()),
        &[&ctx.payer, &buyer]).await.unwrap();
    refresh_blockhash(&mut ctx).await;

    let lam_before = lamports_of(&mut ctx, &creator.pubkey()).await;
    // Creator sells 2 of their 3 keys
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        sell_shares_ix(creator.pubkey(), "selfee", 2, creator.pubkey(), ctx.payer.pubkey(), creator.pubkey()),
        &[&ctx.payer, &creator]).await.unwrap();
    let lam_after = lamports_of(&mut ctx, &creator.pubkey()).await;
    assert!(lam_after > lam_before, "creator should net SOL from self-sell (incl. subject fee merge)");
}

#[tokio::test]
async fn set_royalty_then_subsequent_buy_uses_new_wallet() {
    let mut ctx = new_ctx().await;
    init(&mut ctx).await;
    let creator = Keypair::new();
    let new_royalty = Keypair::new();
    let buyer = Keypair::new();
    fund(&mut ctx, &creator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &new_royalty.pubkey(), 100_000_000).await;
    fund(&mut ctx, &buyer.pubkey(), 5_000_000_000).await;
    launch_key(&mut ctx, &creator, "royflow").await;
    refresh_blockhash(&mut ctx).await;
    // Switch royalty to a fresh wallet with 50% of subject fee
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        set_royalty_ix(creator.pubkey(), "royflow", new_royalty.pubkey(), 50),
        &[&ctx.payer, &creator]).await.unwrap();
    refresh_blockhash(&mut ctx).await;
    let royalty_lam_before = lamports_of(&mut ctx, &new_royalty.pubkey()).await;
    // Buyer buys with the new royalty wallet in the keys
    send_with(&mut ctx.banks_client, ctx.last_blockhash,
        buy_shares_ix(buyer.pubkey(), "royflow", 5, 10_000_000_000, creator.pubkey(), ctx.payer.pubkey(), new_royalty.pubkey()),
        &[&ctx.payer, &buyer]).await.unwrap();
    let royalty_lam_after = lamports_of(&mut ctx, &new_royalty.pubkey()).await;
    assert!(royalty_lam_after > royalty_lam_before, "new royalty wallet must receive funds");
}
