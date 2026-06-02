use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::instruction::Instruction,
        InstructionData, ToAccountMetas,
    },
    litesvm::{types::FailedTransactionMetadata, LiteSVM},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

// ─── helpers ──────────────────────────────────────────────────────────────────

fn make_svm() -> (LiteSVM, Keypair) {
    let bytes = include_bytes!("../../../target/deploy/friendtech_shares.so");
    let mut svm = LiteSVM::new();
    svm.add_program(friendtech_shares::id(), bytes).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    (svm, payer)
}

fn send(
    svm: &mut LiteSVM,
    signers: &[&Keypair],
    ix: Instruction,
) -> Result<(), FailedTransactionMetadata> {
    let payer_pk = signers[0].pubkey();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer_pk), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).map(|_| ())
}

fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config"], &friendtech_shares::id())
}

fn subject_state_pda(subject: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"subject", subject.as_ref()], &friendtech_shares::id())
}

fn balance_state_pda(subject: &Pubkey, holder: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"balance", subject.as_ref(), holder.as_ref()],
        &friendtech_shares::id(),
    )
}

fn ix_initialize_protocol(
    authority: &Pubkey,
    protocol_fee_percent: u64,
    subject_fee_percent: u64,
) -> Instruction {
    let (config, _) = config_pda();
    Instruction::new_with_bytes(
        friendtech_shares::id(),
        &friendtech_shares::instruction::InitializeProtocol {
            protocol_fee_percent,
            subject_fee_percent,
        }
        .data(),
        friendtech_shares::accounts::InitializeProtocol {
            authority: *authority,
            config,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

fn ix_buy_shares(
    buyer: &Pubkey,
    subject: &Pubkey,
    fee_destination: &Pubkey,
    amount: u64,
) -> Instruction {
    let (config, _) = config_pda();
    let (subject_state, _) = subject_state_pda(subject);
    let (balance_state, _) = balance_state_pda(subject, buyer);
    Instruction::new_with_bytes(
        friendtech_shares::id(),
        &friendtech_shares::instruction::BuyShares { amount }.data(),
        friendtech_shares::accounts::BuyShares {
            buyer: *buyer,
            subject: *subject,
            config,
            fee_destination: *fee_destination,
            subject_state,
            balance_state,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

fn ix_sell_shares(
    seller: &Pubkey,
    subject: &Pubkey,
    fee_destination: &Pubkey,
    amount: u64,
) -> Instruction {
    let (config, _) = config_pda();
    let (subject_state, _) = subject_state_pda(subject);
    let (balance_state, _) = balance_state_pda(subject, seller);
    Instruction::new_with_bytes(
        friendtech_shares::id(),
        &friendtech_shares::instruction::SellShares { amount }.data(),
        friendtech_shares::accounts::SellShares {
            seller: *seller,
            subject: *subject,
            config,
            fee_destination: *fee_destination,
            subject_state,
            balance_state,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

// ─── tests ────────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_protocol() {
    let (mut svm, authority) = make_svm();
    let ix = ix_initialize_protocol(&authority.pubkey(), 50_000_000, 50_000_000);
    assert!(send(&mut svm, &[&authority], ix).is_ok());

    let (config_addr, _) = config_pda();
    let config: friendtech_shares::ProtocolConfig = {
        let raw = svm.get_account(&config_addr).unwrap();
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_ref()).unwrap()
    };
    assert_eq!(config.protocol_fee_percent, 50_000_000);
    assert_eq!(config.subject_fee_percent, 50_000_000);
    assert_eq!(config.authority, authority.pubkey());
    assert_eq!(config.fee_destination, authority.pubkey());
}

#[test]
fn test_fee_too_high_rejected() {
    let (mut svm, authority) = make_svm();
    // 21% exceeds 20% cap
    let ix = ix_initialize_protocol(&authority.pubkey(), 210_000_000, 0);
    assert!(send(&mut svm, &[&authority], ix).is_err());
}

#[test]
fn test_subject_buys_first_share() {
    let (mut svm, authority) = make_svm();
    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();

    let init_ix = ix_initialize_protocol(&authority.pubkey(), 50_000_000, 50_000_000);
    send(&mut svm, &[&authority], init_ix).unwrap();

    // Creator buys share #1 — price is 0 (supply=0, amount=1 → sum=0)
    let buy_ix = ix_buy_shares(&creator.pubkey(), &creator.pubkey(), &authority.pubkey(), 1);
    assert!(send(&mut svm, &[&creator], buy_ix).is_ok());

    let (ss_addr, _) = subject_state_pda(&creator.pubkey());
    let ss: friendtech_shares::SubjectState = {
        let raw = svm.get_account(&ss_addr).unwrap();
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_ref()).unwrap()
    };
    assert_eq!(ss.supply, 1);

    let (bs_addr, _) = balance_state_pda(&creator.pubkey(), &creator.pubkey());
    let bs: friendtech_shares::BalanceState = {
        let raw = svm.get_account(&bs_addr).unwrap();
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_ref()).unwrap()
    };
    assert_eq!(bs.balance, 1);
}

#[test]
fn test_non_subject_cannot_buy_first_share() {
    let (mut svm, authority) = make_svm();
    let creator = Keypair::new();
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 5_000_000_000).unwrap();

    let init_ix = ix_initialize_protocol(&authority.pubkey(), 50_000_000, 50_000_000);
    send(&mut svm, &[&authority], init_ix).unwrap();

    // Stranger tries to buy creator's first share — must fail
    let buy_ix = ix_buy_shares(&stranger.pubkey(), &creator.pubkey(), &authority.pubkey(), 1);
    assert!(send(&mut svm, &[&stranger], buy_ix).is_err());
}

#[test]
fn test_buyer_can_buy_after_first_share() {
    let (mut svm, authority) = make_svm();
    let creator = Keypair::new();
    let buyer = Keypair::new();
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&buyer.pubkey(), 5_000_000_000).unwrap();

    let init_ix = ix_initialize_protocol(&authority.pubkey(), 50_000_000, 50_000_000);
    send(&mut svm, &[&authority], init_ix).unwrap();

    send(&mut svm, &[&creator], ix_buy_shares(&creator.pubkey(), &creator.pubkey(), &authority.pubkey(), 1)).unwrap();

    // Buyer purchases 2 more shares (supply is now 1)
    let buy_ix = ix_buy_shares(&buyer.pubkey(), &creator.pubkey(), &authority.pubkey(), 2);
    assert!(send(&mut svm, &[&buyer], buy_ix).is_ok());

    let (ss_addr, _) = subject_state_pda(&creator.pubkey());
    let ss: friendtech_shares::SubjectState = {
        let raw = svm.get_account(&ss_addr).unwrap();
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_ref()).unwrap()
    };
    assert_eq!(ss.supply, 3);
}

#[test]
fn test_holder_can_sell_shares() {
    let (mut svm, authority) = make_svm();
    let creator = Keypair::new();
    let buyer = Keypair::new();
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&buyer.pubkey(), 5_000_000_000).unwrap();

    // 0% fees so sell price equals buy price exactly
    let init_ix = ix_initialize_protocol(&authority.pubkey(), 0, 0);
    send(&mut svm, &[&authority], init_ix).unwrap();

    send(&mut svm, &[&creator], ix_buy_shares(&creator.pubkey(), &creator.pubkey(), &authority.pubkey(), 1)).unwrap();
    send(&mut svm, &[&buyer], ix_buy_shares(&buyer.pubkey(), &creator.pubkey(), &authority.pubkey(), 3)).unwrap();

    // Buyer sells 2 of their 3 shares
    let sell_ix = ix_sell_shares(&buyer.pubkey(), &creator.pubkey(), &authority.pubkey(), 2);
    assert!(send(&mut svm, &[&buyer], sell_ix).is_ok());

    let (bs_addr, _) = balance_state_pda(&creator.pubkey(), &buyer.pubkey());
    let bs: friendtech_shares::BalanceState = {
        let raw = svm.get_account(&bs_addr).unwrap();
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_ref()).unwrap()
    };
    assert_eq!(bs.balance, 1);
}

#[test]
fn test_cannot_sell_last_share() {
    let (mut svm, authority) = make_svm();
    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();

    let init_ix = ix_initialize_protocol(&authority.pubkey(), 0, 0);
    send(&mut svm, &[&authority], init_ix).unwrap();

    send(&mut svm, &[&creator], ix_buy_shares(&creator.pubkey(), &creator.pubkey(), &authority.pubkey(), 1)).unwrap();

    // Creator tries to sell the only remaining share — must fail
    let sell_ix = ix_sell_shares(&creator.pubkey(), &creator.pubkey(), &authority.pubkey(), 1);
    assert!(send(&mut svm, &[&creator], sell_ix).is_err());
}

#[test]
fn test_cannot_sell_more_than_balance() {
    let (mut svm, authority) = make_svm();
    let creator = Keypair::new();
    let buyer = Keypair::new();
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&buyer.pubkey(), 5_000_000_000).unwrap();

    let init_ix = ix_initialize_protocol(&authority.pubkey(), 0, 0);
    send(&mut svm, &[&authority], init_ix).unwrap();

    send(&mut svm, &[&creator], ix_buy_shares(&creator.pubkey(), &creator.pubkey(), &authority.pubkey(), 1)).unwrap();
    send(&mut svm, &[&buyer], ix_buy_shares(&buyer.pubkey(), &creator.pubkey(), &authority.pubkey(), 2)).unwrap();

    // Buyer holds 2, tries to sell 5 — must fail
    let sell_ix = ix_sell_shares(&buyer.pubkey(), &creator.pubkey(), &authority.pubkey(), 5);
    assert!(send(&mut svm, &[&buyer], sell_ix).is_err());
}

#[test]
fn test_buy_then_sell_net_loss_due_to_fees() {
    let (mut svm, authority) = make_svm();
    let creator = Keypair::new();
    let buyer = Keypair::new();
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&buyer.pubkey(), 5_000_000_000).unwrap();

    // 5% + 5% = 10% round-trip cost
    let init_ix = ix_initialize_protocol(&authority.pubkey(), 50_000_000, 50_000_000);
    send(&mut svm, &[&authority], init_ix).unwrap();

    send(&mut svm, &[&creator], ix_buy_shares(&creator.pubkey(), &creator.pubkey(), &authority.pubkey(), 1)).unwrap();

    let bal_before = svm.get_account(&buyer.pubkey()).unwrap().lamports;
    send(&mut svm, &[&buyer], ix_buy_shares(&buyer.pubkey(), &creator.pubkey(), &authority.pubkey(), 2)).unwrap();
    send(&mut svm, &[&buyer], ix_sell_shares(&buyer.pubkey(), &creator.pubkey(), &authority.pubkey(), 2)).unwrap();
    let bal_after = svm.get_account(&buyer.pubkey()).unwrap().lamports;

    // Buyer should have less SOL after buying and selling (fees taken on both sides)
    assert!(bal_after < bal_before, "buy-then-sell should net a loss due to fees");
}

#[test]
fn test_multiple_holders_same_subject() {
    let (mut svm, authority) = make_svm();
    let creator = Keypair::new();
    let buyer_a = Keypair::new();
    let buyer_b = Keypair::new();
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&buyer_a.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&buyer_b.pubkey(), 5_000_000_000).unwrap();

    let init_ix = ix_initialize_protocol(&authority.pubkey(), 0, 0);
    send(&mut svm, &[&authority], init_ix).unwrap();

    send(&mut svm, &[&creator], ix_buy_shares(&creator.pubkey(), &creator.pubkey(), &authority.pubkey(), 1)).unwrap();
    send(&mut svm, &[&buyer_a], ix_buy_shares(&buyer_a.pubkey(), &creator.pubkey(), &authority.pubkey(), 2)).unwrap();
    send(&mut svm, &[&buyer_b], ix_buy_shares(&buyer_b.pubkey(), &creator.pubkey(), &authority.pubkey(), 3)).unwrap();

    let (ss_addr, _) = subject_state_pda(&creator.pubkey());
    let ss: friendtech_shares::SubjectState = {
        let raw = svm.get_account(&ss_addr).unwrap();
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_ref()).unwrap()
    };
    assert_eq!(ss.supply, 6);

    // buyer_b sells their 3 shares
    send(&mut svm, &[&buyer_b], ix_sell_shares(&buyer_b.pubkey(), &creator.pubkey(), &authority.pubkey(), 3)).unwrap();

    let ss_after: friendtech_shares::SubjectState = {
        let raw = svm.get_account(&ss_addr).unwrap();
        anchor_lang::AccountDeserialize::try_deserialize(&mut raw.data.as_ref()).unwrap()
    };
    assert_eq!(ss_after.supply, 3);
}
