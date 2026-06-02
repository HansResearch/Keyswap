// Auto-generated from friendtech-final/src/{lib,state,errors,pricing}.rs
// Hand-maintained to mirror the deployed Anchor program.
// If you change the Rust, update this file to match.

export const IDL = {
  version: '0.1.0',
  name: 'friendtech_shares',
  instructions: [
    {
      name: 'initializeProtocol',
      accounts: [
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'config', isMut: true, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'protocolFeePercent', type: 'u64' },
        { name: 'subjectFeePercent', type: 'u64' },
      ],
    },
    {
      name: 'proposeFees',
      accounts: [
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'config', isMut: false, isSigner: false },
        { name: 'feeProposal', isMut: true, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'protocolFeePercent', type: 'u64' },
        { name: 'subjectFeePercent', type: 'u64' },
      ],
    },
    {
      name: 'applyFees',
      accounts: [
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'config', isMut: true, isSigner: false },
        { name: 'feeProposal', isMut: true, isSigner: false },
      ],
      args: [],
    },
    {
      name: 'proposeFeeDestination',
      accounts: [
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'config', isMut: false, isSigner: false },
        { name: 'newDestination', isMut: false, isSigner: false },
        { name: 'feeDestProposal', isMut: true, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: 'applyFeeDestination',
      accounts: [
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'config', isMut: true, isSigner: false },
        { name: 'feeDestProposal', isMut: true, isSigner: false },
      ],
      args: [],
    },
    {
      name: 'createKey',
      accounts: [
        { name: 'creator', isMut: true, isSigner: true },
        { name: 'subjectName', isMut: true, isSigner: false },
        { name: 'subjectState', isMut: true, isSigner: false },
        { name: 'mint', isMut: true, isSigner: false },
        { name: 'metadata', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'metadataProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
        { name: 'rent', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'name', type: 'string' },
        { name: 'uri', type: 'string' },
      ],
    },
    {
      name: 'setRoyaltyWallet',
      accounts: [
        { name: 'creator', isMut: false, isSigner: true },
        { name: 'subjectName', isMut: false, isSigner: false },
        { name: 'subjectState', isMut: true, isSigner: false },
        { name: 'newRoyaltyWallet', isMut: false, isSigner: false },
      ],
      args: [{ name: 'percent', type: 'u64' }],
    },
    {
      name: 'buyShares',
      accounts: [
        { name: 'buyer', isMut: true, isSigner: true },
        { name: 'subjectName', isMut: false, isSigner: false },
        { name: 'subject', isMut: true, isSigner: false },
        { name: 'config', isMut: false, isSigner: false },
        { name: 'feeDestination', isMut: true, isSigner: false },
        { name: 'royaltyWallet', isMut: true, isSigner: false },
        { name: 'subjectState', isMut: true, isSigner: false },
        { name: 'mint', isMut: true, isSigner: false },
        { name: 'buyerAta', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'associatedTokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'amount', type: 'u64' },
        { name: 'maxCost', type: 'u64' },
      ],
    },
    {
      name: 'sellShares',
      accounts: [
        { name: 'seller', isMut: true, isSigner: true },
        { name: 'subjectName', isMut: false, isSigner: false },
        { name: 'subject', isMut: true, isSigner: false },
        { name: 'config', isMut: false, isSigner: false },
        { name: 'feeDestination', isMut: true, isSigner: false },
        { name: 'royaltyWallet', isMut: true, isSigner: false },
        { name: 'subjectState', isMut: true, isSigner: false },
        { name: 'mint', isMut: true, isSigner: false },
        { name: 'sellerAta', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
  ],
  accounts: [
    {
      name: 'ProtocolConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'publicKey' },
          { name: 'feeDestination', type: 'publicKey' },
          { name: 'burnDestination', type: 'publicKey' },
          { name: 'protocolFeePercent', type: 'u64' },
          { name: 'subjectFeePercent', type: 'u64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'FeeProposal',
      type: {
        kind: 'struct',
        fields: [
          { name: 'pendingProtocolFee', type: 'u64' },
          { name: 'pendingSubjectFee', type: 'u64' },
          { name: 'applyAfter', type: 'i64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'FeeDestinationProposal',
      type: {
        kind: 'struct',
        fields: [
          { name: 'pendingDestination', type: 'publicKey' },
          { name: 'applyAfter', type: 'i64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'SubjectState',
      type: {
        kind: 'struct',
        fields: [
          { name: 'subject', type: 'publicKey' },
          { name: 'supply', type: 'u64' },
          { name: 'priceFloor', type: 'u64' },
          { name: 'name', type: { array: ['u8', 32] } },
          { name: 'hasName', type: 'bool' },
          { name: 'royaltyWallet', type: 'publicKey' },
          { name: 'royaltyPercent', type: 'u64' },
          { name: 'mintBump', type: 'u8' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'SubjectName',
      type: {
        kind: 'struct',
        fields: [
          { name: 'subject', type: 'publicKey' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
  events: [
    {
      name: 'TradeEvent',
      fields: [
        { name: 'trader', type: 'publicKey', index: false },
        { name: 'subject', type: 'publicKey', index: false },
        { name: 'isBuy', type: 'bool', index: false },
        { name: 'keyAmount', type: 'u64', index: false },
        { name: 'solAmount', type: 'u64', index: false },
        { name: 'protocolFee', type: 'u64', index: false },
        { name: 'subjectFee', type: 'u64', index: false },
        { name: 'royaltyFee', type: 'u64', index: false },
        { name: 'supply', type: 'u64', index: false },
      ],
    },
    {
      name: 'KeyCreatedEvent',
      fields: [
        { name: 'creator', type: 'publicKey', index: false },
        { name: 'name', type: 'string', index: false },
      ],
    },
    {
      name: 'RoyaltyChangedEvent',
      fields: [
        { name: 'subject', type: 'publicKey', index: false },
        { name: 'royaltyWallet', type: 'publicKey', index: false },
        { name: 'royaltyPercent', type: 'u64', index: false },
      ],
    },
    {
      name: 'FeeChangeProposedEvent',
      fields: [
        { name: 'protocolFeePercent', type: 'u64', index: false },
        { name: 'subjectFeePercent', type: 'u64', index: false },
        { name: 'applyAfter', type: 'i64', index: false },
      ],
    },
    {
      name: 'FeeChangeAppliedEvent',
      fields: [
        { name: 'protocolFeePercent', type: 'u64', index: false },
        { name: 'subjectFeePercent', type: 'u64', index: false },
      ],
    },
    {
      name: 'FeeDestinationProposedEvent',
      fields: [
        { name: 'newDestination', type: 'publicKey', index: false },
        { name: 'applyAfter', type: 'i64', index: false },
      ],
    },
    {
      name: 'FeeDestinationAppliedEvent',
      fields: [
        { name: 'newDestination', type: 'publicKey', index: false },
      ],
    },
  ],
  errors: [
    { code: 6000, name: 'OnlySubjectCanBuyFirst', msg: 'Only the subject can buy the first share' },
    { code: 6001, name: 'CannotSellLastShare', msg: 'Cannot sell the last share' },
    { code: 6002, name: 'InsufficientShares', msg: 'Insufficient shares' },
    { code: 6003, name: 'InsufficientPayment', msg: 'Insufficient SOL sent' },
    { code: 6004, name: 'MathOverflow', msg: 'Math overflow' },
    { code: 6005, name: 'Unauthorized', msg: 'Caller is not the protocol authority' },
    { code: 6006, name: 'FeeTooHigh', msg: 'Fee percent exceeds maximum (10% per side, 20% combined)' },
    { code: 6007, name: 'ZeroAmount', msg: 'Amount must be greater than zero' },
    { code: 6008, name: 'NameTooShort', msg: 'Name must be at least 3 characters' },
    { code: 6009, name: 'NameTooLong', msg: 'Name must be at most 32 characters' },
    { code: 6010, name: 'NameInvalidChars', msg: 'Name may only contain lowercase a-z and 0-9' },
    { code: 6011, name: 'NameAlreadySet', msg: 'This subject already has a name set' },
    { code: 6012, name: 'InvalidRoyaltyPercent', msg: 'Royalty percent must be 0-100' },
    { code: 6013, name: 'InvalidRoyaltyWallet', msg: 'Royalty wallet does not match stored wallet' },
    { code: 6014, name: 'InsufficientEscrow', msg: 'Escrow has insufficient SOL for payout' },
    { code: 6015, name: 'ExceedsCreatorFirstBuyLimit', msg: 'Creator first buy cannot exceed 50 keys' },
    { code: 6016, name: 'CreatorFirstBuyTooSmall', msg: 'Creator must buy at least 3 keys at launch' },
    { code: 6017, name: 'MaxSupplyReached', msg: 'Max supply of 10,000 keys reached' },
    { code: 6018, name: 'SlippageExceeded', msg: 'Buy cost exceeds max_cost slippage guard' },
    { code: 6019, name: 'NoPendingFeeChange', msg: 'No pending fee change to apply' },
    { code: 6020, name: 'FeeTimelockNotElapsed', msg: 'Fee timelock has not elapsed (48 hours required)' },
    { code: 6021, name: 'InvalidWalletAccount', msg: 'Account must be a System-owned wallet (not a program-owned account)' },
  ],
} as const
